set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.address_resolution_queue') is null
    or to_regclass('public.geofences') is null
    or to_regclass('public.geofence_radius_policies') is null
    or to_regclass('public.trip_cargo_divergences') is null
    or to_regprocedure('private.normalized_address_text(text)') is null
    or to_regprocedure('private.normalized_client_address(public.clients)') is null
    or to_regprocedure('public.resolve_address_queue_item_v1(jsonb)') is null
    or to_regprocedure('public.upsert_geofence_v2(jsonb)') is null
    or to_regprocedure('public.upsert_geofence_v3(jsonb)') is null
    or to_regprocedure('private.request_tenant_id()') is null
    or to_regprocedure('private.is_request_tenant_member(uuid)') is null
    or to_regprocedure('private.review_trip_cargo_divergence(uuid,uuid,text,text)') is null then
    raise exception 'canonical_destination_geocoding_idempotency_prerequisites_missing';
  end if;
end;
$preflight$;

-- A destination is an address owned by the tenant, not by a client. Clients,
-- ad-hoc stops and geofences can all point at the same normalized address.
create table public.canonical_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$'),
  normalized_address text not null check (length(normalized_address) between 8 and 1000),
  status text not null default 'pending' check (status in ('pending','ambiguous','verified','ignored','error')),
  latitude double precision,
  longitude double precision,
  provider text,
  accuracy_m double precision,
  confidence double precision,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,address_hash),
  unique(tenant_id,id),
  check ((latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)),
  check (accuracy_m is null or accuracy_m between 0 and 100000),
  check (confidence is null or confidence between 0 and 1)
);

alter table public.canonical_addresses enable row level security;
revoke all on table public.canonical_addresses from public,anon,authenticated,service_role;
grant select on table public.canonical_addresses to authenticated,service_role;
grant insert,update on table public.canonical_addresses to service_role;
create policy canonical_addresses_select on public.canonical_addresses for select to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_operator_or_admin(tenant_id));

alter table public.clients add column if not exists canonical_address_id uuid;
alter table public.dispatch_stops add column if not exists canonical_address_id uuid;
alter table public.geofences
  add column if not exists canonical_address_id uuid,
  add column if not exists client_id uuid;

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conname='clients_canonical_address_tenant_fk') then
    alter table public.clients add constraint clients_canonical_address_tenant_fk
      foreign key(tenant_id,canonical_address_id) references public.canonical_addresses(tenant_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='dispatch_stops_canonical_address_tenant_fk') then
    alter table public.dispatch_stops add constraint dispatch_stops_canonical_address_tenant_fk
      foreign key(tenant_id,canonical_address_id) references public.canonical_addresses(tenant_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='geofences_canonical_address_tenant_fk') then
    alter table public.geofences add constraint geofences_canonical_address_tenant_fk
      foreign key(tenant_id,canonical_address_id) references public.canonical_addresses(tenant_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='geofences_client_tenant_fk') then
    alter table public.geofences add constraint geofences_client_tenant_fk
      foreign key(tenant_id,client_id) references public.clients(tenant_id,id) on delete restrict;
  end if;
end;
$constraints$;

create index if not exists idx_dispatch_stops_canonical_address
  on public.dispatch_stops(tenant_id,canonical_address_id) where canonical_address_id is not null;
create index if not exists idx_geofences_canonical_address
  on public.geofences(tenant_id,canonical_address_id) where canonical_address_id is not null;
create index if not exists idx_geofences_client
  on public.geofences(tenant_id,client_id) where client_id is not null;

create or replace function private.ensure_canonical_address_v1(_tenant_id uuid,_address text)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_address text:=private.normalized_address_text(_address);v_hash text;v_id uuid;
begin
  if _tenant_id is null or length(v_address) not between 8 and 1000 then return null;end if;
  v_hash:=encode(sha256(convert_to(v_address,'UTF8')),'hex');
  insert into public.canonical_addresses(tenant_id,address_hash,normalized_address)
    values(_tenant_id,v_hash,v_address)
    on conflict(tenant_id,address_hash) do update set normalized_address=excluded.normalized_address
    returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function private.ensure_canonical_address_v1(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.bind_client_canonical_address_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_address text;
begin
  v_address:=private.normalized_client_address(new);
  new.canonical_address_id:=private.ensure_canonical_address_v1(new.tenant_id,v_address);
  return new;
end;
$function$;
revoke all on function private.bind_client_canonical_address_v1() from public,anon,authenticated,service_role;
drop trigger if exists zz_bind_client_canonical_address on public.clients;
create trigger zz_bind_client_canonical_address before insert or update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.bind_client_canonical_address_v1();

create or replace function private.sync_client_canonical_geocode_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.canonical_address_id is not null then
    update public.canonical_addresses set status=new.address_geocode_status,latitude=new.address_lat,
      longitude=new.address_lng,provider=new.address_geocode_provider,accuracy_m=new.address_geocode_accuracy_m,
      confidence=new.address_geocode_confidence,resolved_at=new.address_geocoded_at,
      resolved_by=new.address_geocoded_by,updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.sync_client_canonical_geocode_v1() from public,anon,authenticated,service_role;
drop trigger if exists sync_client_canonical_geocode on public.clients;
create trigger sync_client_canonical_geocode after insert or update of canonical_address_id,address_geocode_status,
  address_lat,address_lng,address_geocode_provider,address_geocode_accuracy_m,address_geocode_confidence,address_geocoded_at
  on public.clients for each row execute function private.sync_client_canonical_geocode_v1();

create or replace function private.bind_dispatch_stop_canonical_address_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_address text;v_canonical public.canonical_addresses%rowtype;
begin
  v_address:=private.normalized_address_text(coalesce(nullif(new.location_address,''),new.destination));
  new.canonical_address_id:=private.ensure_canonical_address_v1(new.tenant_id,v_address);
  if new.canonical_address_id is not null and new.location_source='address_geocoded'
    and new.latitude between -90 and 90 and new.longitude between -180 and 180 then
    update public.canonical_addresses set status='verified',latitude=new.latitude,longitude=new.longitude,
      provider=new.location_provider,accuracy_m=new.location_accuracy_m,confidence=new.location_confidence,
      resolved_at=coalesce(new.location_resolved_at,clock_timestamp()),resolved_by=new.location_resolved_by,
      updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  elsif new.canonical_address_id is not null and new.location_source<>'map_selected' then
    select * into v_canonical from public.canonical_addresses
      where tenant_id=new.tenant_id and id=new.canonical_address_id;
    if found and v_canonical.status='verified' and v_canonical.latitude is not null and v_canonical.longitude is not null then
      new.latitude:=v_canonical.latitude;new.longitude:=v_canonical.longitude;
      new.location_source:='address_geocoded';new.location_address:=v_canonical.normalized_address;
      new.location_provider:=v_canonical.provider;new.location_accuracy_m:=v_canonical.accuracy_m;
      new.location_confidence:=v_canonical.confidence;new.location_resolved_at:=v_canonical.resolved_at;
      new.location_resolved_by:=v_canonical.resolved_by;new.location_verification_status:='verified';
      new.location_invalidated_at:=null;new.location_audit:=coalesce(new.location_audit,'{}'::jsonb)
        ||jsonb_build_object('selection','reused_canonical_destination','canonical_address_id',v_canonical.id,
          'address_hash',v_canonical.address_hash);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.bind_dispatch_stop_canonical_address_v1() from public,anon,authenticated,service_role;
drop trigger if exists bind_dispatch_stop_canonical_address on public.dispatch_stops;
create trigger bind_dispatch_stop_canonical_address before insert or update of destination,location_address
  on public.dispatch_stops for each row execute function private.bind_dispatch_stop_canonical_address_v1();

-- Existing rows remain valid. The backfill only adds canonical links and never
-- changes an already selected coordinate.
update public.clients c set canonical_address_id=private.ensure_canonical_address_v1(c.tenant_id,private.normalized_client_address(c))
where c.canonical_address_id is null and length(private.normalized_client_address(c)) between 8 and 1000;
update public.dispatch_stops s set canonical_address_id=private.ensure_canonical_address_v1(
  s.tenant_id,coalesce(nullif(s.location_address,''),s.destination))
where s.canonical_address_id is null
  and length(private.normalized_address_text(coalesce(nullif(s.location_address,''),s.destination))) between 8 and 1000;

alter table public.address_resolution_queue drop constraint if exists address_resolution_queue_client_tenant_fk;
alter table public.address_resolution_queue drop constraint if exists address_resolution_queue_entity_type_check;
alter table public.address_resolution_queue add constraint address_resolution_queue_entity_type_check
  check(entity_type in ('client','dispatch_stop'));
alter table public.address_resolution_queue add column if not exists canonical_address_id uuid;
do $queue_fk$
begin
  if not exists(select 1 from pg_constraint where conname='address_resolution_queue_canonical_tenant_fk') then
    alter table public.address_resolution_queue add constraint address_resolution_queue_canonical_tenant_fk
      foreign key(tenant_id,canonical_address_id) references public.canonical_addresses(tenant_id,id) on delete restrict;
  end if;
end;
$queue_fk$;

create or replace function private.validate_address_resolution_subject_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_expected uuid;v_canonical public.canonical_addresses%rowtype;
begin
  new.canonical_address_id:=coalesce(new.canonical_address_id,
    private.ensure_canonical_address_v1(new.tenant_id,new.address_snapshot));
  select * into v_canonical from public.canonical_addresses
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  if not found or v_canonical.address_hash<>new.address_hash then
    raise exception 'address_resolution_canonical_mismatch' using errcode='23514';
  end if;
  if new.entity_type='client' then
    select canonical_address_id into v_expected from public.clients
      where tenant_id=new.tenant_id and id=new.entity_id;
  elsif new.entity_type='dispatch_stop' then
    select canonical_address_id into v_expected from public.dispatch_stops
      where tenant_id=new.tenant_id and id=new.entity_id;
  else
    raise exception 'address_resolution_subject_invalid' using errcode='23514';
  end if;
  if not found or v_expected is distinct from new.canonical_address_id then
    raise exception 'address_resolution_subject_tenant_mismatch' using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.validate_address_resolution_subject_v1() from public,anon,authenticated,service_role;
drop trigger if exists validate_address_resolution_subject on public.address_resolution_queue;
create trigger validate_address_resolution_subject before insert or update of tenant_id,entity_type,entity_id,
  address_snapshot,address_hash,canonical_address_id on public.address_resolution_queue
  for each row execute function private.validate_address_resolution_subject_v1();

update public.address_resolution_queue q set canonical_address_id=private.ensure_canonical_address_v1(q.tenant_id,q.address_snapshot)
where q.canonical_address_id is null;

create or replace function private.enqueue_dispatch_stop_geocode_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_canonical public.canonical_addresses%rowtype;
begin
  if new.canonical_address_id is null or new.location_source='map_selected' then return null;end if;
  select * into v_canonical from public.canonical_addresses
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  if found and v_canonical.status<>'verified' and new.location_source<>'map_selected' then
    insert into public.address_resolution_queue(tenant_id,entity_type,entity_id,canonical_address_id,address_snapshot,
      address_hash,status,candidates,attempts,last_error,resolved_at,resolved_by,invalidated_at,updated_at,
      processed_at,next_attempt_at,resolution_kind,resolution_details)
    values(new.tenant_id,'dispatch_stop',new.id,v_canonical.id,v_canonical.normalized_address,
      v_canonical.address_hash,'pending','[]'::jsonb,0,null,null,null,
      case when tg_op='UPDATE' then clock_timestamp() else null end,clock_timestamp(),null,clock_timestamp(),null,'{}'::jsonb)
    on conflict(tenant_id,entity_type,entity_id) do update set canonical_address_id=excluded.canonical_address_id,
      address_snapshot=excluded.address_snapshot,address_hash=excluded.address_hash,status='pending',candidates='[]'::jsonb,
      attempts=0,last_error=null,resolved_lat=null,resolved_lng=null,resolved_provider=null,resolved_accuracy_m=null,
      resolved_confidence=null,resolved_at=null,resolved_by=null,invalidated_at=excluded.invalidated_at,
      processed_at=null,next_attempt_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
      resolution_kind=null,resolution_details='{}'::jsonb,updated_at=clock_timestamp();
  end if;
  return null;
end;
$function$;
revoke all on function private.enqueue_dispatch_stop_geocode_v1() from public,anon,authenticated,service_role;
drop trigger if exists enqueue_dispatch_stop_geocode on public.dispatch_stops;
create trigger enqueue_dispatch_stop_geocode after insert or update of canonical_address_id,destination,location_address,
  latitude,longitude,location_source on public.dispatch_stops for each row
  execute function private.enqueue_dispatch_stop_geocode_v1();

insert into public.address_resolution_queue(tenant_id,entity_type,entity_id,canonical_address_id,address_snapshot,
  address_hash,status,candidates,attempts,updated_at,next_attempt_at,resolution_details)
select s.tenant_id,'dispatch_stop',s.id,a.id,a.normalized_address,a.address_hash,'pending','[]'::jsonb,0,
  clock_timestamp(),clock_timestamp(),'{}'::jsonb
from public.dispatch_stops s join public.canonical_addresses a
  on a.tenant_id=s.tenant_id and a.id=s.canonical_address_id
where s.client_id is null and s.location_source<>'map_selected' and a.status<>'verified'
  and not(s.status=any(public.stop_terminal_statuses()))
on conflict(tenant_id,entity_type,entity_id) do nothing;

create or replace function private.bind_geofence_canonical_scope_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_stop public.dispatch_stops%rowtype;v_client public.clients%rowtype;
begin
  if new.scope_kind='delivery' or new.dispatch_stop_id is not null then
    select * into v_stop from public.dispatch_stops
      where tenant_id=new.tenant_id and id=new.dispatch_stop_id;
    if not found then raise exception 'delivery_geofence_stop_tenant_mismatch' using errcode='23514';end if;
    new.client_id:=v_stop.client_id;
    new.canonical_address_id:=v_stop.canonical_address_id;
  elsif new.category='client' and new.client_id is not null then
    select * into v_client from public.clients where tenant_id=new.tenant_id and id=new.client_id;
    if not found then raise exception 'fleet_geofence_client_tenant_mismatch' using errcode='23514';end if;
    new.canonical_address_id:=coalesce(v_client.canonical_address_id,new.canonical_address_id);
  else
    new.client_id:=null;
    if new.source_address is not null then
      new.canonical_address_id:=private.ensure_canonical_address_v1(new.tenant_id,new.source_address);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.bind_geofence_canonical_scope_v1() from public,anon,authenticated,service_role;
drop trigger if exists bind_geofence_canonical_scope on public.geofences;
create trigger bind_geofence_canonical_scope before insert or update of tenant_id,scope_kind,dispatch_stop_id,
  category,client_id,source_address on public.geofences for each row
  execute function private.bind_geofence_canonical_scope_v1();

-- Delivery fences are backfilled from their stop and remain independent of a
-- client row. Fleet/client fences may use client_id, but it is optional.
update public.geofences g set client_id=s.client_id,canonical_address_id=s.canonical_address_id
from public.dispatch_stops s where g.tenant_id=s.tenant_id and g.dispatch_stop_id=s.id and g.scope_kind='delivery';
update public.geofences g set canonical_address_id=private.ensure_canonical_address_v1(g.tenant_id,g.source_address)
where g.scope_kind='fleet' and g.canonical_address_id is null and g.source_address is not null
  and length(private.normalized_address_text(g.source_address)) between 8 and 1000;
update public.geofences g set client_id=(
  select c.id from public.clients c where c.tenant_id=g.tenant_id
    and c.canonical_address_id=g.canonical_address_id order by c.id limit 1
)
where g.scope_kind='fleet' and g.category='client' and g.client_id is null and g.canonical_address_id is not null
  and 1=(select count(*) from public.clients c where c.tenant_id=g.tenant_id
    and c.canonical_address_id=g.canonical_address_id);

create table public.operator_command_ledger (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('resolve_address','upsert_geofence','review_trip_cargo_divergence')),
  entity_type text not null,
  entity_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,request_id)
);
alter table public.operator_command_ledger enable row level security;
revoke all on table public.operator_command_ledger from public,anon,authenticated,service_role;
grant select on table public.operator_command_ledger to authenticated,service_role;
grant insert on table public.operator_command_ledger to service_role;
create policy operator_command_ledger_select on public.operator_command_ledger for select to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and actor_id=auth.uid() and public.is_tenant_operator_or_admin(tenant_id));

-- Earlier policies authorized any tenant membership, which let a user who is a
-- member of A+B address B while the signed active-tenant claim was A. Keep all
-- direct read/write surfaces used by these commands bound to the active claim.
alter table public.address_resolution_queue enable row level security;
drop policy if exists address_resolution_queue_select on public.address_resolution_queue;
drop policy if exists address_resolution_queue_update on public.address_resolution_queue;
drop policy if exists address_resolution_queue_insert on public.address_resolution_queue;
create policy address_resolution_queue_select on public.address_resolution_queue for select to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id));
create policy address_resolution_queue_update on public.address_resolution_queue for update to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id))
  with check (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id));
create policy address_resolution_queue_insert on public.address_resolution_queue for insert to authenticated
  with check (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id));

alter table public.geofence_radius_policies enable row level security;
drop policy if exists geofence_radius_policies_select on public.geofence_radius_policies;
drop policy if exists geofence_radius_policies_update on public.geofence_radius_policies;
create policy geofence_radius_policies_select on public.geofence_radius_policies for select to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id));
create policy geofence_radius_policies_update on public.geofence_radius_policies for update to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id))
  with check (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id));

alter table public.geofences enable row level security;
drop policy if exists "Admins can manage geofences" on public.geofences;
drop policy if exists "Members can view geofences" on public.geofences;
create policy "Admins can manage geofences" on public.geofences for all to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id))
  with check (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id));
create policy "Members can view geofences" on public.geofences for select to authenticated
  using (private.request_tenant_id()=tenant_id and private.is_request_tenant_member(tenant_id));

create or replace function private.reject_operator_command_ledger_mutation_v1()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin raise exception 'operator_command_ledger_is_append_only' using errcode='42501';end;
$function$;
revoke all on function private.reject_operator_command_ledger_mutation_v1() from public,anon,authenticated,service_role;
create trigger operator_command_ledger_immutable before update or delete on public.operator_command_ledger
  for each row execute function private.reject_operator_command_ledger_mutation_v1();

create or replace function private.resolve_address_queue_item_v2(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_id uuid:=nullif(_payload->>'queue_id','')::uuid;v_actor uuid:=auth.uid();v_hash text;
  v_existing public.operator_command_ledger%rowtype;v_item public.address_resolution_queue%rowtype;
  v_lat double precision:=nullif(_payload->>'latitude','')::double precision;
  v_lng double precision:=nullif(_payload->>'longitude','')::double precision;v_provider text:=nullif(_payload->>'provider','');
  v_kind text:=coalesce(nullif(_payload->>'selection_kind',''),'assisted_candidate');v_details jsonb;v_result jsonb;
begin
  if v_actor is null or v_tenant is null or v_request is null or v_id is null
    or private.request_tenant_id() is distinct from v_tenant or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if v_lat is null or v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180 or v_provider is null
    or v_kind not in ('assisted_candidate','manual_map') or (v_kind='manual_map' and v_provider<>'leaflet_map') then
    raise exception 'invalid_address_resolution' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||v_tenant::text||':'||v_request::text,0));
  select * into v_existing from public.operator_command_ledger
    where tenant_id=v_tenant and request_id=v_request;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'resolve_address' or v_existing.entity_id<>v_id
      or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';end if;
    return v_existing.response;
  end if;
  select * into v_item from public.address_resolution_queue where id=v_id and tenant_id=v_tenant for update;
  if not found or v_item.status not in ('pending','ambiguous','error') then
    raise exception 'address_resolution_not_available' using errcode='23514';end if;
  v_details:=jsonb_build_object('selected_label',left(coalesce(_payload->>'label','Ponto ajustado no mapa'),500),
    'selection',v_kind,'previous_lat',nullif(_payload->>'previous_lat','')::double precision,
    'previous_lng',nullif(_payload->>'previous_lng','')::double precision,'request_id',v_request);
  update public.canonical_addresses set status='verified',latitude=v_lat,longitude=v_lng,provider=v_provider,
    accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    confidence=nullif(_payload->>'confidence','')::double precision,resolved_at=clock_timestamp(),
    resolved_by=v_actor,updated_at=clock_timestamp()
  where tenant_id=v_tenant and id=v_item.canonical_address_id and address_hash=v_item.address_hash;
  if not found then raise exception 'address_changed_during_resolution' using errcode='40001';end if;
  update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
    address_geocode_provider=v_provider,address_geocode_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    address_geocode_confidence=nullif(_payload->>'confidence','')::double precision,address_geocoded_at=clock_timestamp(),
    address_geocoded_by=v_actor,address_geocode_hash=v_item.address_hash,address_geocode_audit=v_details
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id;
  update public.dispatch_stops set latitude=v_lat,longitude=v_lng,location_source='address_geocoded',
    location_address=(select normalized_address from public.canonical_addresses where id=v_item.canonical_address_id),
    location_provider=v_provider,location_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    location_confidence=nullif(_payload->>'confidence','')::double precision,location_resolved_at=clock_timestamp(),
    location_resolved_by=v_actor,location_verification_status='verified',location_invalidated_at=null,
    location_audit=coalesce(location_audit,'{}'::jsonb)||v_details
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id
    and location_source<>'map_selected' and not(status=any(public.stop_terminal_statuses()));
  update public.address_resolution_queue set status='resolved',resolved_lat=v_lat,resolved_lng=v_lng,
    resolved_provider=v_provider,resolved_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    resolved_confidence=nullif(_payload->>'confidence','')::double precision,resolved_at=clock_timestamp(),
    resolved_by=v_actor,processed_at=coalesce(processed_at,clock_timestamp()),lease_token=null,lease_expires_at=null,
    resolution_kind=v_kind,resolution_details=v_details,updated_at=clock_timestamp()
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id
    and status in ('pending','ambiguous','error');
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'queue_id',v_id,
    'canonical_address_id',v_item.canonical_address_id,'selection_kind',v_kind);
  insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
    values(v_tenant,v_request,v_actor,'resolve_address',v_item.entity_type,v_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function private.resolve_address_queue_item_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.resolve_address_queue_item_v2(jsonb) to authenticated;
create or replace function public.resolve_address_queue_item_v2(_payload jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on'
as $function$ select private.resolve_address_queue_item_v2(_payload) $function$;
revoke all on function public.resolve_address_queue_item_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.resolve_address_queue_item_v2(jsonb) to authenticated;
revoke execute on function public.resolve_address_queue_item_v1(jsonb) from authenticated;

create or replace function private.upsert_geofence_v4(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_actor uuid:=auth.uid();v_hash text;v_id uuid:=nullif(_payload->>'id','')::uuid;v_client uuid:=nullif(_payload->>'client_id','')::uuid;
  v_existing public.operator_command_ledger%rowtype;v_result jsonb;
begin
  if v_actor is null or v_tenant is null or v_request is null
    or private.request_tenant_id() is distinct from v_tenant or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||v_tenant::text||':'||v_request::text,0));
  select * into v_existing from public.operator_command_ledger where tenant_id=v_tenant and request_id=v_request;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'upsert_geofence' or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';end if;
    return v_existing.response;
  end if;
  v_id:=public.upsert_geofence_v3(_payload-'request_id');
  update public.geofences g set client_id=case when g.category='client' then v_client else null end,
    canonical_address_id=case when g.category='client' and v_client is not null then
      (select c.canonical_address_id from public.clients c where c.tenant_id=v_tenant and c.id=v_client)
      else private.ensure_canonical_address_v1(v_tenant,g.source_address) end
  where g.tenant_id=v_tenant and g.id=v_id;
  if not found then raise exception 'geofence_not_found' using errcode='P0002';end if;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'geofence_id',v_id);
  insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
    values(v_tenant,v_request,v_actor,'upsert_geofence','geofence',v_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function private.upsert_geofence_v4(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.upsert_geofence_v4(jsonb) to authenticated;
create or replace function public.upsert_geofence_v4(_payload jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on'
as $function$ select private.upsert_geofence_v4(_payload) $function$;
revoke all on function public.upsert_geofence_v4(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upsert_geofence_v4(jsonb) to authenticated;
revoke execute on function public.upsert_geofence_v3(jsonb) from authenticated;
revoke execute on function public.upsert_geofence_v2(jsonb) from authenticated;

create or replace function private.review_trip_cargo_divergence_v2(
  _tenant_id uuid,_divergence_id uuid,_request_id uuid,_status text,_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid();v_hash text;v_existing public.operator_command_ledger%rowtype;v_result jsonb;
begin
  if v_actor is null or _tenant_id is null or _divergence_id is null or _request_id is null
    or private.request_tenant_id() is distinct from _tenant_id or not private.is_request_tenant_member(_tenant_id)
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('divergence_id',_divergence_id,
    'status',_status,'reason',btrim(coalesce(_reason,'')))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||_tenant_id::text||':'||_request_id::text,0));
  select * into v_existing from public.operator_command_ledger where tenant_id=_tenant_id and request_id=_request_id;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'review_trip_cargo_divergence'
      or v_existing.entity_id<>_divergence_id or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';end if;
    return v_existing.response;
  end if;
  v_result:=private.review_trip_cargo_divergence(_tenant_id,_divergence_id,_status,_reason)
    ||jsonb_build_object('request_id',_request_id,'idempotent',false);
  insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
    values(_tenant_id,_request_id,v_actor,'review_trip_cargo_divergence','trip_cargo_divergence',
      _divergence_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function private.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text) to authenticated;
create or replace function public.review_trip_cargo_divergence_v2(
  _tenant_id uuid,_divergence_id uuid,_request_id uuid,_status text,_reason text
) returns jsonb language sql security invoker set search_path='' set row_security='on'
as $function$
  select private.review_trip_cargo_divergence_v2(_tenant_id,_divergence_id,_request_id,_status,_reason)
$function$;
revoke all on function public.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text) to authenticated;
revoke execute on function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text) from authenticated;
revoke execute on function private.review_trip_cargo_divergence(uuid,uuid,text,text) from authenticated;

create or replace function public.get_address_resolution_queue_v1(_tenant_id uuid,_status text default null,_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not private.is_request_tenant_member(_tenant_id)
    or not coalesce(public.is_tenant_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if _status is not null and _status not in ('pending','ambiguous','resolved','ignored','error') then
    raise exception 'invalid_address_resolution_status' using errcode='22023';end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at,q.id),'[]'::jsonb) into v_result
  from (select r.id,r.tenant_id,r.entity_type,r.entity_id,r.canonical_address_id,r.address_snapshot,
      r.address_hash,r.status,r.candidates,r.attempts,r.last_error,r.invalidated_at,r.created_at,r.updated_at,
      case when r.entity_type='client' then coalesce(c.company_name,c.trade_name,'Cliente')
        else coalesce(s.destination,'Destino avulso') end company_name,
      case when r.entity_type='client' then c.trade_name else null end trade_name
    from public.address_resolution_queue r
    left join public.clients c on r.entity_type='client' and c.id=r.entity_id and c.tenant_id=r.tenant_id
    left join public.dispatch_stops s on r.entity_type='dispatch_stop' and s.id=r.entity_id and s.tenant_id=r.tenant_id
    where r.tenant_id=_tenant_id and (_status is null or r.status=_status)
      and ((r.entity_type='client' and c.id is not null) or (r.entity_type='dispatch_stop' and s.id is not null))
    order by r.updated_at,r.id limit greatest(1,least(coalesce(_limit,100),500))) q;
  return v_result;
end;
$function$;
revoke all on function public.get_address_resolution_queue_v1(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_address_resolution_queue_v1(uuid,text,integer) to authenticated;

create or replace function public.claim_address_resolution_queue_v2(_limit integer default 5,_lease_seconds integer default 45)
returns table(id uuid,tenant_id uuid,entity_type text,entity_id uuid,address_snapshot text,address_hash text,
  lease_token uuid,attempts integer)
language plpgsql security invoker set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if _limit not between 1 and 25 or _lease_seconds not between 15 and 300 then
    raise exception 'invalid_address_queue_claim' using errcode='22023';end if;
  return query with due as (
    select q.id,gen_random_uuid() token from public.address_resolution_queue q
    where q.status in ('pending','error') and q.processed_at is null and q.attempts<10
      and q.next_attempt_at<=clock_timestamp() and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
      and exists(select 1 from public.canonical_addresses a where a.tenant_id=q.tenant_id
        and a.id=q.canonical_address_id and a.address_hash=q.address_hash and a.status in ('pending','error','ambiguous'))
      and ((q.entity_type='client' and exists(select 1 from public.clients c where c.tenant_id=q.tenant_id
        and c.id=q.entity_id and c.canonical_address_id=q.canonical_address_id))
        or (q.entity_type='dispatch_stop' and exists(select 1 from public.dispatch_stops s where s.tenant_id=q.tenant_id
          and s.id=q.entity_id and s.canonical_address_id=q.canonical_address_id)))
    order by q.next_attempt_at,q.updated_at,q.id for update of q skip locked limit _limit
  ), claimed as (
    update public.address_resolution_queue q set lease_token=due.token,
      lease_expires_at=clock_timestamp()+make_interval(secs=>_lease_seconds),updated_at=clock_timestamp()
    from due where q.id=due.id returning q.id,q.tenant_id,q.entity_type,q.entity_id,q.address_snapshot,
      q.address_hash,q.lease_token,q.attempts
  ) select * from claimed;
end;
$function$;
revoke all on function public.claim_address_resolution_queue_v2(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_address_resolution_queue_v2(integer,integer) to service_role;

do $postcondition$
begin
  if not (select relrowsecurity from pg_class where oid='public.canonical_addresses'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.operator_command_ledger'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.address_resolution_queue'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.geofences'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.geofence_radius_policies'::regclass)
    or exists(select 1 from pg_policy where polrelid='public.operator_command_ledger'::regclass and polcmd<>'r')
    or exists(select 1 from pg_policy where polrelid in ('public.canonical_addresses'::regclass,
        'public.operator_command_ledger'::regclass,'public.address_resolution_queue'::regclass,
        'public.geofences'::regclass,'public.geofence_radius_policies'::regclass)
      and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid),'') not like '%request_tenant_id%')
    or 9<>(select count(*) from pg_policy where polrelid in ('public.canonical_addresses'::regclass,
        'public.operator_command_ledger'::regclass,'public.address_resolution_queue'::regclass,
        'public.geofences'::regclass,'public.geofence_radius_policies'::regclass)
      and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid),'') like '%request_tenant_id%')
    or not has_table_privilege('authenticated','public.canonical_addresses','select')
    or has_table_privilege('authenticated','public.canonical_addresses','insert,update,delete')
    or not has_table_privilege('authenticated','public.operator_command_ledger','select')
    or has_table_privilege('authenticated','public.operator_command_ledger','insert,update,delete')
    or has_function_privilege('anon','public.resolve_address_queue_item_v2(jsonb)','execute')
    or has_function_privilege('anon','public.upsert_geofence_v4(jsonb)','execute')
    or has_function_privilege('anon','public.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text)','execute')
    or not has_function_privilege('authenticated','public.resolve_address_queue_item_v2(jsonb)','execute')
    or not has_function_privilege('authenticated','public.upsert_geofence_v4(jsonb)','execute')
    or not has_function_privilege('authenticated','public.review_trip_cargo_divergence_v2(uuid,uuid,uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.resolve_address_queue_item_v1(jsonb)','execute')
    or has_function_privilege('authenticated','public.upsert_geofence_v2(jsonb)','execute')
    or has_function_privilege('authenticated','public.upsert_geofence_v3(jsonb)','execute')
    or has_function_privilege('authenticated','public.review_trip_cargo_divergence_v1(uuid,uuid,text,text)','execute')
    or has_function_privilege('authenticated','private.review_trip_cargo_divergence(uuid,uuid,text,text)','execute')
    or not exists(select 1 from pg_trigger where tgname='operator_command_ledger_immutable' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname='enqueue_dispatch_stop_geocode' and not tgisinternal) then
    raise exception 'canonical_destination_geocoding_idempotency_postcondition_failed';
  end if;
end;
$postcondition$;
