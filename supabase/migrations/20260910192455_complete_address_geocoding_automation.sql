set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.address_resolution_queue') is null
    or to_regprocedure('public.resolve_address_queue_item_v1(jsonb)') is null
    or to_regprocedure('private.sync_delivery_geofence_from_stop()') is null
    or to_regprocedure('public.dispatch_planned_route_v3(jsonb)') is null then
    raise exception 'complete_address_geocoding_automation_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.address_resolution_queue
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default clock_timestamp(),
  add column if not exists processed_at timestamptz,
  add column if not exists last_worker_request_key text,
  add column if not exists resolution_kind text,
  add column if not exists resolution_details jsonb not null default '{}'::jsonb;

alter table public.address_resolution_queue
  drop constraint if exists address_resolution_queue_lease_pair_check,
  add constraint address_resolution_queue_lease_pair_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  drop constraint if exists address_resolution_queue_resolution_kind_check,
  add constraint address_resolution_queue_resolution_kind_check check (
    resolution_kind is null or resolution_kind in (
      'auto_candidates','assisted_candidate','manual_map','reused_verified_client'
    )
  );

create index if not exists idx_address_resolution_queue_due_worker
  on public.address_resolution_queue(next_attempt_at,updated_at,id)
  where status in ('pending','error') and processed_at is null;
create index if not exists idx_address_resolution_queue_lease_expiry
  on public.address_resolution_queue(lease_expires_at)
  where lease_token is not null;

create table if not exists public.address_resolution_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_id uuid references public.address_resolution_queue(id) on delete set null,
  entity_type text not null check (entity_type in ('client','dispatch_stop','geofence')),
  entity_id uuid not null,
  address_hash text,
  event_kind text not null check (event_kind in (
    'geocode_candidates_created','geocode_failed','assisted_candidate_selected',
    'manual_map_adjustment','verified_client_geocode_reused','address_changed_invalidated'
  )),
  latitude double precision,
  longitude double precision,
  provider text,
  actor_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check ((latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180))
);
create index if not exists idx_address_resolution_audit_tenant_entity
  on public.address_resolution_audit_events(tenant_id,entity_type,entity_id,created_at desc);

alter table public.address_resolution_audit_events enable row level security;
revoke all on table public.address_resolution_audit_events from public,anon,authenticated,service_role;
grant select on table public.address_resolution_audit_events to authenticated,service_role;
grant insert on table public.address_resolution_audit_events to service_role;
create policy address_resolution_audit_events_select
  on public.address_resolution_audit_events for select to authenticated
  using (public.is_tenant_admin(tenant_id));

create or replace function private.reject_address_resolution_audit_mutation()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  raise exception 'address_resolution_audit_is_append_only' using errcode='42501';
end;
$function$;
revoke all on function private.reject_address_resolution_audit_mutation() from public,anon,authenticated,service_role;
drop trigger if exists address_resolution_audit_events_immutable on public.address_resolution_audit_events;
create trigger address_resolution_audit_events_immutable before update or delete
  on public.address_resolution_audit_events for each row
  execute function private.reject_address_resolution_audit_mutation();

create or replace function private.audit_address_resolution_queue_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_kind text;v_details jsonb;
begin
  if new.address_hash is distinct from old.address_hash then
    v_kind:='address_changed_invalidated';
    v_details:=jsonb_build_object('previous_address_hash',old.address_hash,'address_snapshot',new.address_snapshot);
  elsif new.status='resolved' and old.status is distinct from 'resolved' then
    v_kind:=case when new.resolution_kind='manual_map' then 'manual_map_adjustment'
      else 'assisted_candidate_selected' end;
    v_details:=new.resolution_details;
  elsif new.processed_at is distinct from old.processed_at and new.processed_at is not null then
    v_kind:='geocode_candidates_created';
    v_details:=jsonb_build_object('candidate_count',jsonb_array_length(new.candidates),'attempts',new.attempts,
      'request_key',new.last_worker_request_key);
  elsif new.status='error' and (old.status is distinct from 'error' or new.attempts is distinct from old.attempts) then
    v_kind:='geocode_failed';
    v_details:=jsonb_build_object('error',left(coalesce(new.last_error,'unknown'),300),'attempts',new.attempts,
      'next_attempt_at',new.next_attempt_at,'request_key',new.last_worker_request_key);
  else
    return new;
  end if;
  insert into public.address_resolution_audit_events(tenant_id,queue_id,entity_type,entity_id,address_hash,event_kind,
    latitude,longitude,provider,actor_id,details)
  values(new.tenant_id,new.id,new.entity_type,new.entity_id,new.address_hash,v_kind,new.resolved_lat,new.resolved_lng,
    new.resolved_provider,new.resolved_by,coalesce(v_details,'{}'::jsonb));
  return new;
end;
$function$;
revoke all on function private.audit_address_resolution_queue_change() from public,anon,authenticated,service_role;
drop trigger if exists audit_address_resolution_queue_change on public.address_resolution_queue;
create trigger audit_address_resolution_queue_change after update on public.address_resolution_queue
  for each row execute function private.audit_address_resolution_queue_change();

create or replace function public.claim_address_resolution_queue_v2(_limit integer default 5,_lease_seconds integer default 45)
returns table(id uuid,tenant_id uuid,entity_type text,entity_id uuid,address_snapshot text,address_hash text,
  lease_token uuid,attempts integer)
language plpgsql security invoker set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if _limit not between 1 and 25 or _lease_seconds not between 15 and 300 then
    raise exception 'invalid_address_queue_claim' using errcode='22023';
  end if;
  return query with due as (
    select q.id,gen_random_uuid() as token
    from public.address_resolution_queue q
    where q.status in ('pending','error') and q.processed_at is null and q.attempts<10
      and q.next_attempt_at<=clock_timestamp()
      and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
      and exists(select 1 from public.clients c where c.tenant_id=q.tenant_id and c.id=q.entity_id
        and c.address_geocode_hash=q.address_hash and c.address_geocode_status in ('pending','error'))
    order by q.next_attempt_at,q.updated_at,q.id
    for update of q skip locked limit _limit
  ), claimed as (
    update public.address_resolution_queue q set lease_token=due.token,
      lease_expires_at=clock_timestamp()+make_interval(secs=>_lease_seconds),updated_at=clock_timestamp()
    from due where q.id=due.id
    returning q.id,q.tenant_id,q.entity_type,q.entity_id,q.address_snapshot,q.address_hash,q.lease_token,q.attempts
  ) select claimed.id,claimed.tenant_id,claimed.entity_type,claimed.entity_id,claimed.address_snapshot,
      claimed.address_hash,claimed.lease_token,claimed.attempts from claimed;
end;
$function$;
revoke all on function public.claim_address_resolution_queue_v2(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_address_resolution_queue_v2(integer,integer) to service_role;

create or replace function public.get_claimed_address_resolution_item_v1(_queue_id uuid,_lease_token uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_item public.address_resolution_queue%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_item from public.address_resolution_queue q where q.id=_queue_id and q.lease_token=_lease_token
    and q.lease_expires_at>clock_timestamp();
  if not found then raise exception 'address_queue_claim_not_available' using errcode='40001';end if;
  return jsonb_build_object('id',v_item.id,'tenant_id',v_item.tenant_id,'entity_type',v_item.entity_type,
    'entity_id',v_item.entity_id,'address_snapshot',v_item.address_snapshot,'address_hash',v_item.address_hash);
end;
$function$;
revoke all on function public.get_claimed_address_resolution_item_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_claimed_address_resolution_item_v1(uuid,uuid) to service_role;

create or replace function public.ack_address_resolution_queue_item_v2(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_id uuid:=nullif(_payload->>'queue_id','')::uuid;v_token uuid:=nullif(_payload->>'lease_token','')::uuid;
  v_request text:=nullif(_payload->>'request_key','');v_hash text:=nullif(_payload->>'address_hash','');
  v_candidates jsonb:=_payload->'candidates';v_item public.address_resolution_queue%rowtype;
  v_error text:=nullif(left(btrim(_payload->>'error'),300),'');v_count integer:=0;
  v_retry_ms integer:=greatest(0,least(coalesce(nullif(_payload->>'retry_after_ms','')::integer,0),3600000));
  v_status text;v_now timestamptz:=clock_timestamp();
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if v_id is null or v_token is null or v_request is null or length(v_request)>500 or v_hash is null then
    raise exception 'invalid_address_queue_ack' using errcode='22023';end if;
  select * into v_item from public.address_resolution_queue where id=v_id for update;
  if not found then raise exception 'address_queue_item_not_found' using errcode='P0002';end if;
  if v_item.address_hash is distinct from v_hash then raise exception 'address_queue_hash_changed' using errcode='40001';end if;
  if v_item.last_worker_request_key=v_request then
    return jsonb_build_object('ok',true,'idempotent',true,'queue_id',v_id,'status',v_item.status);
  end if;
  if v_item.lease_token is distinct from v_token or v_item.lease_expires_at<=v_now then
    raise exception 'address_queue_lease_lost' using errcode='40001';end if;
  if v_candidates is not null and jsonb_typeof(v_candidates)<>'array' then
    raise exception 'invalid_geocoding_candidates' using errcode='22023';end if;
  if v_candidates is not null then v_count:=jsonb_array_length(v_candidates);end if;
  if v_count>5 then raise exception 'too_many_geocoding_candidates' using errcode='22023';end if;
  v_status:=case when v_error is not null or v_count=0 then 'error' when v_count=1 then 'pending' else 'ambiguous' end;
  update public.address_resolution_queue set status=v_status,candidates=coalesce(v_candidates,'[]'::jsonb),
    attempts=attempts+1,last_error=case when v_status='error' then coalesce(v_error,'no_candidates') else null end,
    processed_at=case when v_status='error' then null else v_now end,
    next_attempt_at=case when v_status='error' then v_now+make_interval(secs=>greatest(
      ceil(v_retry_ms/1000.0)::integer,least(3600,(power(2,least(attempts+1,6))*60)::integer))) else v_now end,
    lease_token=null,lease_expires_at=null,last_worker_request_key=v_request,resolution_kind='auto_candidates',
    resolution_details=jsonb_build_object('cache',_payload->>'cache','candidate_count',v_count),updated_at=v_now
  where id=v_id;
  update public.clients set address_geocode_status=v_status
    where tenant_id=v_item.tenant_id and id=v_item.entity_id and address_geocode_hash=v_item.address_hash;
  return jsonb_build_object('ok',true,'idempotent',false,'queue_id',v_id,'status',v_status,'candidate_count',v_count);
end;
$function$;
revoke all on function public.ack_address_resolution_queue_item_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ack_address_resolution_queue_item_v2(jsonb) to service_role;

-- A normalized text helper lets clients and dispatch destinations share one
-- stable key without exposing a second normalization implementation to the UI.
create or replace function private.normalized_address_text(_address text)
returns text language sql immutable set search_path=''
as $function$
  select lower(regexp_replace(btrim(coalesce(_address,'')),'\s+',' ','g'))
$function$;
revoke all on function private.normalized_address_text(text) from public,anon,authenticated,service_role;

create or replace function public.get_routing_client_locations_v1(_tenant_id uuid,_client_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' set row_security='on'
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if coalesce(cardinality(_client_ids),0)>500 then raise exception 'too_many_routing_clients' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'address_street',c.address_street,
    'address_number',c.address_number,'address_complement',c.address_complement,
    'address_neighborhood',c.address_neighborhood,'address_city',c.address_city,'address_state',c.address_state,
    'address_zip',c.address_zip,'address_geocode_status',c.address_geocode_status,
    'address_lat',case when c.address_geocode_status='verified' then c.address_lat else null end,
    'address_lng',case when c.address_geocode_status='verified' then c.address_lng else null end,
    'address_geocode_hash',case when c.address_geocode_status='verified' then c.address_geocode_hash else null end,
    'address_geocode_provider',case when c.address_geocode_status='verified' then c.address_geocode_provider else null end,
    'address_geocode_accuracy_m',case when c.address_geocode_status='verified' then c.address_geocode_accuracy_m else null end,
    'address_geocode_confidence',case when c.address_geocode_status='verified' then c.address_geocode_confidence else null end)
    order by c.id),'[]'::jsonb) into v_result
  from public.clients c where c.tenant_id=_tenant_id and c.id=any(coalesce(_client_ids,'{}'::uuid[]));
  return v_result;
end;
$function$;
revoke all on function public.get_routing_client_locations_v1(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_routing_client_locations_v1(uuid,uuid[]) to authenticated;

create or replace function private.reuse_verified_client_geocode()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare v_match public.clients%rowtype;
begin
  if new.address_geocode_hash is null or new.address_geocode_status<>'pending' then return new;end if;
  select * into v_match from public.clients c where c.tenant_id=new.tenant_id and c.id<>new.id
    and c.address_geocode_hash=new.address_geocode_hash and c.address_geocode_status='verified'
    and c.address_lat is not null and c.address_lng is not null
    order by c.address_geocoded_at desc nulls last,c.id limit 1;
  if found then
    new.address_lat:=v_match.address_lat;new.address_lng:=v_match.address_lng;new.address_geocode_status:='verified';
    new.address_geocode_provider:=v_match.address_geocode_provider;
    new.address_geocode_accuracy_m:=v_match.address_geocode_accuracy_m;
    new.address_geocode_confidence:=v_match.address_geocode_confidence;
    new.address_geocoded_at:=clock_timestamp();new.address_geocoded_by:=null;
    new.address_geocode_audit:=jsonb_build_object('selection','reused_verified_client','source_client_id',v_match.id,
      'address_hash',new.address_geocode_hash);
  end if;
  return new;
end;
$function$;
revoke all on function private.reuse_verified_client_geocode() from public,anon,authenticated,service_role;
drop trigger if exists clients_reuse_verified_geocode on public.clients;
create trigger clients_reuse_verified_geocode before insert or update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.reuse_verified_client_geocode();

create or replace function private.audit_reused_client_geocode()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.address_geocode_status='verified' and new.address_geocode_audit->>'selection'='reused_verified_client'
    and (tg_op='INSERT' or new.address_geocode_hash is distinct from old.address_geocode_hash
      or old.address_geocode_status is distinct from 'verified') then
    insert into public.address_resolution_audit_events(tenant_id,entity_type,entity_id,address_hash,event_kind,
      latitude,longitude,provider,actor_id,details)
    values(new.tenant_id,'client',new.id,new.address_geocode_hash,'verified_client_geocode_reused',
      new.address_lat,new.address_lng,new.address_geocode_provider,auth.uid(),new.address_geocode_audit);
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_reused_client_geocode() from public,anon,authenticated,service_role;
drop trigger if exists clients_audit_reused_geocode on public.clients;
create trigger clients_audit_reused_geocode after insert or update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.audit_reused_client_geocode();

create or replace function private.enqueue_client_geocode()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare v_address text;v_reused boolean;
begin
  v_address:=private.normalized_client_address(new);
  v_reused:=new.address_geocode_status='verified' and new.address_geocode_audit->>'selection'='reused_verified_client';
  if new.address_geocode_hash is not null and (new.address_geocode_status='pending' or v_reused) then
    insert into public.address_resolution_queue(tenant_id,entity_type,entity_id,address_snapshot,address_hash,status,
      candidates,attempts,last_error,resolved_lat,resolved_lng,resolved_provider,resolved_accuracy_m,resolved_confidence,
      resolved_at,resolved_by,invalidated_at,updated_at,processed_at,next_attempt_at,resolution_kind,resolution_details)
    values(new.tenant_id,'client',new.id,v_address,new.address_geocode_hash,case when v_reused then 'resolved' else 'pending' end,
      '[]'::jsonb,0,null,new.address_lat,new.address_lng,new.address_geocode_provider,new.address_geocode_accuracy_m,
      new.address_geocode_confidence,case when v_reused then clock_timestamp() else null end,null,
      case when tg_op='UPDATE' then clock_timestamp() else null end,clock_timestamp(),
      case when v_reused then clock_timestamp() else null end,clock_timestamp(),
      case when v_reused then 'reused_verified_client' else null end,
      case when v_reused then new.address_geocode_audit else '{}'::jsonb end)
    on conflict(tenant_id,entity_type,entity_id) do update set address_snapshot=excluded.address_snapshot,
      address_hash=excluded.address_hash,status=excluded.status,candidates='[]'::jsonb,attempts=0,last_error=null,
      resolved_lat=excluded.resolved_lat,resolved_lng=excluded.resolved_lng,resolved_provider=excluded.resolved_provider,
      resolved_accuracy_m=excluded.resolved_accuracy_m,resolved_confidence=excluded.resolved_confidence,
      resolved_at=excluded.resolved_at,resolved_by=null,invalidated_at=excluded.invalidated_at,
      processed_at=excluded.processed_at,next_attempt_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
      resolution_kind=excluded.resolution_kind,resolution_details=excluded.resolution_details,updated_at=clock_timestamp();
  end if;
  return null;
end;
$function$;
revoke all on function private.enqueue_client_geocode() from public,anon,authenticated,service_role;

alter table public.dispatch_stops
  add column if not exists source_client_address_hash text,
  add column if not exists location_verification_status text not null default 'pending',
  add column if not exists location_invalidated_at timestamptz;
alter table public.dispatch_stops drop constraint if exists dispatch_stops_location_verification_status_check;
alter table public.dispatch_stops add constraint dispatch_stops_location_verification_status_check
  check(location_verification_status in ('pending','verified','exception'));

update public.dispatch_stops set location_verification_status=case
  when latitude is not null and longitude is not null and location_source in ('address_geocoded','map_selected') then 'verified'
  when length(btrim(coalesce(location_exception_reason,'')))>=20 then 'exception' else 'pending' end;

create or replace function private.apply_verified_client_geocode_to_stop()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare v_client public.clients%rowtype;v_stop_address text;
begin
  if new.location_source='map_selected' and new.latitude is not null and new.longitude is not null then
    new.location_verification_status:='verified';new.source_client_address_hash:=null;return new;
  end if;
  if new.client_id is not null then
    select * into v_client from public.clients c where c.tenant_id=new.tenant_id and c.id=new.client_id;
    v_stop_address:=private.normalized_address_text(coalesce(nullif(new.location_address,''),new.destination));
    if found and v_client.address_geocode_status='verified' and v_client.address_lat is not null and v_client.address_lng is not null
      and v_client.address_geocode_hash=encode(sha256(convert_to(v_stop_address,'UTF8')),'hex') then
      new.latitude:=v_client.address_lat;new.longitude:=v_client.address_lng;new.location_source:='address_geocoded';
      new.location_address:=v_stop_address;new.location_provider:=v_client.address_geocode_provider;
      new.location_accuracy_m:=v_client.address_geocode_accuracy_m;new.location_confidence:=v_client.address_geocode_confidence;
      new.location_resolved_at:=coalesce(v_client.address_geocoded_at,clock_timestamp());new.location_resolved_by:=v_client.address_geocoded_by;
      new.source_client_address_hash:=v_client.address_geocode_hash;new.location_verification_status:='verified';
      new.location_invalidated_at:=null;new.location_audit:=coalesce(new.location_audit,'{}'::jsonb)||jsonb_build_object(
        'selection','reused_verified_client','source_client_id',v_client.id,'address_hash',v_client.address_geocode_hash);
      return new;
    end if;
  end if;
  new.source_client_address_hash:=null;
  new.location_verification_status:=case when length(btrim(coalesce(new.location_exception_reason,'')))>=20 then 'exception'
    when new.latitude is not null and new.longitude is not null and new.location_source='address_geocoded' then 'verified'
    else 'pending' end;
  return new;
end;
$function$;
revoke all on function private.apply_verified_client_geocode_to_stop() from public,anon,authenticated,service_role;
drop trigger if exists apply_verified_client_geocode_to_stop on public.dispatch_stops;
create trigger apply_verified_client_geocode_to_stop before insert or update of client_id,destination,latitude,longitude,
  location_source,location_address,location_provider,location_accuracy_m,location_confidence,location_exception_reason
  on public.dispatch_stops for each row execute function private.apply_verified_client_geocode_to_stop();

create or replace function private.audit_dispatch_stop_geocode_reuse()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.source_client_address_hash is not null
    and (tg_op='INSERT' or new.source_client_address_hash is distinct from old.source_client_address_hash) then
    insert into public.address_resolution_audit_events(tenant_id,entity_type,entity_id,address_hash,event_kind,latitude,
      longitude,provider,actor_id,details)
    values(new.tenant_id,'dispatch_stop',new.id,new.source_client_address_hash,'verified_client_geocode_reused',
      new.latitude,new.longitude,new.location_provider,auth.uid(),jsonb_build_object('client_id',new.client_id,
      'dispatch_trip_id',new.dispatch_trip_id,'location_address',new.location_address));
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_dispatch_stop_geocode_reuse() from public,anon,authenticated,service_role;
drop trigger if exists audit_dispatch_stop_geocode_reuse on public.dispatch_stops;
create trigger audit_dispatch_stop_geocode_reuse after insert or update of source_client_address_hash
  on public.dispatch_stops for each row execute function private.audit_dispatch_stop_geocode_reuse();

create or replace function private.audit_manual_map_location_adjustment()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_previous_lat double precision;v_previous_lng double precision;v_source text;v_lat double precision;v_lng double precision;
  v_provider text;v_tenant uuid;v_entity uuid;v_kind text;v_details jsonb;
begin
  if tg_table_name='dispatch_stops' then
    v_source:=new.location_source;v_lat:=new.latitude;v_lng:=new.longitude;v_provider:=new.location_provider;
    v_tenant:=new.tenant_id;v_entity:=new.id;v_kind:='dispatch_stop';
    if tg_op='UPDATE' then v_previous_lat:=old.latitude;v_previous_lng:=old.longitude;end if;
    v_details:=jsonb_build_object('dispatch_trip_id',new.dispatch_trip_id,'location_address',new.location_address,
      'previous_lat',v_previous_lat,'previous_lng',v_previous_lng);
  else
    v_source:=new.source_kind;v_lat:=new.center_lat;v_lng:=new.center_lng;v_provider:=new.location_provider;
    v_tenant:=new.tenant_id;v_entity:=new.id;v_kind:='geofence';
    if new.scope_kind<>'fleet' then return new;end if;
    if tg_op='UPDATE' then v_previous_lat:=old.center_lat;v_previous_lng:=old.center_lng;end if;
    v_details:=jsonb_build_object('name',new.name,'previous_lat',v_previous_lat,'previous_lng',v_previous_lng);
  end if;
  if v_source='map_selected' and v_lat is not null and v_lng is not null
    and (tg_op='INSERT' or v_lat is distinct from v_previous_lat or v_lng is distinct from v_previous_lng) then
    insert into public.address_resolution_audit_events(tenant_id,entity_type,entity_id,event_kind,latitude,longitude,
      provider,actor_id,details)
    values(v_tenant,v_kind,v_entity,'manual_map_adjustment',v_lat,v_lng,v_provider,auth.uid(),v_details);
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_manual_map_location_adjustment() from public,anon,authenticated,service_role;
drop trigger if exists audit_dispatch_stop_manual_map_adjustment on public.dispatch_stops;
create trigger audit_dispatch_stop_manual_map_adjustment after insert or update of latitude,longitude,location_source
  on public.dispatch_stops for each row execute function private.audit_manual_map_location_adjustment();
drop trigger if exists audit_geofence_manual_map_adjustment on public.geofences;
create trigger audit_geofence_manual_map_adjustment after insert or update of center_lat,center_lng,source_kind
  on public.geofences for each row execute function private.audit_manual_map_location_adjustment();

create or replace function private.pause_client_delivery_locations_after_address_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_new_address text;
begin
  if new.address_geocode_hash is not distinct from old.address_geocode_hash then return new;end if;
  v_new_address:=private.normalized_client_address(new);
  update public.dispatch_stops s set location_address=v_new_address,latitude=null,longitude=null,
    location_source='legacy_coordinates',location_provider=null,location_accuracy_m=null,location_confidence=null,
    location_resolved_at=null,location_resolved_by=null,source_client_address_hash=null,
    location_verification_status='pending',location_invalidated_at=clock_timestamp(),location_exception_reason=null,
    location_exception_at=null,location_exception_by=null,location_audit=coalesce(s.location_audit,'{}'::jsonb)||jsonb_build_object(
      'invalidated_at',clock_timestamp(),'reason','client_address_changed','previous_address_hash',old.address_geocode_hash,
      'address_hash',new.address_geocode_hash)
  where s.tenant_id=new.tenant_id and s.client_id=new.id
    and s.source_client_address_hash=old.address_geocode_hash
    and not (s.status=any(public.stop_terminal_statuses()));
  return new;
end;
$function$;
revoke all on function private.pause_client_delivery_locations_after_address_change() from public,anon,authenticated,service_role;
drop trigger if exists clients_pause_delivery_locations on public.clients;
create trigger clients_pause_delivery_locations after update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.pause_client_delivery_locations_after_address_change();

create or replace function private.resume_client_delivery_locations_after_verification()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.address_geocode_status='verified' and new.address_lat is not null and new.address_lng is not null
    and (old.address_geocode_status is distinct from 'verified' or old.address_lat is distinct from new.address_lat
      or old.address_lng is distinct from new.address_lng or old.address_geocode_hash is distinct from new.address_geocode_hash) then
    update public.dispatch_stops s set location_address=private.normalized_client_address(new),
      location_source='address_geocoded'
    where s.tenant_id=new.tenant_id and s.client_id=new.id and s.location_verification_status='pending'
      and private.normalized_address_text(s.location_address)=private.normalized_client_address(new)
      and not (s.status=any(public.stop_terminal_statuses()));
  end if;
  return new;
end;
$function$;
revoke all on function private.resume_client_delivery_locations_after_verification() from public,anon,authenticated,service_role;
drop trigger if exists clients_resume_delivery_locations on public.clients;
create trigger clients_resume_delivery_locations after update of address_geocode_status,address_lat,address_lng,
  address_street,address_number,address_complement,address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.resume_client_delivery_locations_after_verification();

create or replace function public.resolve_address_queue_item_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_id uuid:=nullif(_payload->>'queue_id','')::uuid;
  v_item public.address_resolution_queue%rowtype;v_lat double precision:=nullif(_payload->>'latitude','')::double precision;
  v_lng double precision:=nullif(_payload->>'longitude','')::double precision;v_provider text:=nullif(_payload->>'provider','');
  v_kind text:=coalesce(nullif(_payload->>'selection_kind',''),'assisted_candidate');v_details jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if v_lat is null or v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180 or v_provider is null
    or v_kind not in ('assisted_candidate','manual_map') or (v_kind='manual_map' and v_provider<>'leaflet_map') then
    raise exception 'invalid_address_resolution' using errcode='22023';end if;
  select * into v_item from public.address_resolution_queue where id=v_id and tenant_id=v_tenant for update;
  if not found or v_item.status not in ('pending','ambiguous','error') then
    raise exception 'address_resolution_not_available' using errcode='23514';end if;
  v_details:=jsonb_build_object('selected_label',left(coalesce(_payload->>'label','Ponto ajustado no mapa'),500),
    'selection',v_kind,'previous_lat',nullif(_payload->>'previous_lat','')::double precision,
    'previous_lng',nullif(_payload->>'previous_lng','')::double precision);
  update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
    address_geocode_provider=v_provider,address_geocode_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    address_geocode_confidence=nullif(_payload->>'confidence','')::double precision,address_geocoded_at=clock_timestamp(),
    address_geocoded_by=auth.uid(),address_geocode_hash=v_item.address_hash,address_geocode_audit=v_details
  where id=v_item.entity_id and tenant_id=v_tenant and address_geocode_hash=v_item.address_hash;
  if not found then raise exception 'address_changed_during_resolution' using errcode='40001';end if;
  update public.address_resolution_queue set status='resolved',resolved_lat=v_lat,resolved_lng=v_lng,
    resolved_provider=v_provider,resolved_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    resolved_confidence=nullif(_payload->>'confidence','')::double precision,resolved_at=clock_timestamp(),
    resolved_by=auth.uid(),processed_at=coalesce(processed_at,clock_timestamp()),lease_token=null,lease_expires_at=null,
    resolution_kind=v_kind,resolution_details=v_details,updated_at=clock_timestamp() where id=v_id;
  return jsonb_build_object('ok',true,'queue_id',v_id,'selection_kind',v_kind);
end;
$function$;
revoke all on function public.resolve_address_queue_item_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.resolve_address_queue_item_v1(jsonb) to authenticated;

-- Rebuild the stop payload with the verified client coordinate before the
-- dispatch validator and writer run. Deliberate map selections remain sovereign.
create or replace function public.dispatch_planned_route_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare v_stop jsonb;v_stops jsonb:='[]'::jsonb;v_effective jsonb;v_order integer:=0;v_source text;v_reason text;
  v_trip uuid;v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_stop_id uuid;v_client public.clients%rowtype;
  v_stop_address text;v_client_id uuid;
begin
  if jsonb_typeof(_payload->'stops') is distinct from 'array' then
    raise exception 'invalid_dispatch_stops' using errcode='22023';end if;
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_client_id:=nullif(v_stop->>'client_id','')::uuid;
    if v_client_id is not null and coalesce(v_stop->>'location_source','')<>'map_selected' then
      select * into v_client from public.clients c where c.tenant_id=v_tenant and c.id=v_client_id;
      v_stop_address:=private.normalized_address_text(coalesce(nullif(v_stop->>'location_address',''),v_stop->>'destination'));
      if found and v_client.address_geocode_status='verified' and v_client.address_lat is not null and v_client.address_lng is not null
        and v_client.address_geocode_hash=encode(sha256(convert_to(v_stop_address,'UTF8')),'hex') then
        v_stop:=v_stop||jsonb_build_object('latitude',v_client.address_lat,'longitude',v_client.address_lng,
          'location_source','address_geocoded','location_address',v_stop_address,
          'location_provider',v_client.address_geocode_provider,'location_accuracy_m',v_client.address_geocode_accuracy_m,
          'location_confidence',v_client.address_geocode_confidence,'location_audit',coalesce(v_stop->'location_audit','{}'::jsonb)
            ||jsonb_build_object('selection','reused_verified_client','source_client_id',v_client.id,
              'address_hash',v_client.address_geocode_hash));
      end if;
    end if;
    v_source:=coalesce(nullif(v_stop->>'location_source',''),'legacy_coordinates');
    v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    if v_source in ('address_geocoded','map_selected') then
      if nullif(v_stop->>'latitude','')::double precision is null or nullif(v_stop->>'latitude','')::double precision not between -90 and 90
        or nullif(v_stop->>'longitude','')::double precision is null or nullif(v_stop->>'longitude','')::double precision not between -180 and 180 then
        raise exception 'dispatch_verified_location_coordinates_required' using errcode='23514';end if;
    elsif v_reason is null or length(v_reason)<20 then
      raise exception 'dispatch_location_verification_or_exception_required' using errcode='23514';
    end if;
    v_stops:=v_stops||jsonb_build_array(v_stop);
  end loop;
  v_effective:=jsonb_set(_payload,'{stops}',v_stops,false);
  v_trip:=public.dispatch_planned_route_v2(v_effective);
  for v_stop in select value from jsonb_array_elements(v_stops) loop
    v_order:=v_order+1;v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    select id into v_stop_id from public.dispatch_stops where tenant_id=v_tenant and dispatch_trip_id=v_trip
      and stop_order=v_order for update;
    if not found then raise exception 'dispatch_stop_not_found' using errcode='40001';end if;
    if v_reason is not null then update public.dispatch_stops set location_exception_reason=v_reason,
      location_exception_at=clock_timestamp(),location_exception_by=auth.uid() where tenant_id=v_tenant and id=v_stop_id;end if;
  end loop;
  return v_trip;
end;
$function$;
revoke all on function public.dispatch_planned_route_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route_v3(jsonb) to authenticated;

do $postcondition$
begin
  if to_regprocedure('public.claim_address_resolution_queue_v2(integer,integer)') is null
    or to_regprocedure('public.ack_address_resolution_queue_item_v2(jsonb)') is null
    or to_regprocedure('public.get_claimed_address_resolution_item_v1(uuid,uuid)') is null
    or not (select relrowsecurity from pg_class where oid='public.address_resolution_audit_events'::regclass)
    or has_function_privilege('authenticated','public.claim_address_resolution_queue_v2(integer,integer)','execute')
    or not has_function_privilege('service_role','public.claim_address_resolution_queue_v2(integer,integer)','execute')
    or not has_function_privilege('authenticated','public.get_routing_client_locations_v1(uuid,uuid[])','execute')
    or not exists(select 1 from pg_trigger where tgname='clients_pause_delivery_locations' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname='address_resolution_audit_events_immutable' and not tgisinternal) then
    raise exception 'complete_address_geocoding_automation_postcondition_failed';
  end if;
end;
$postcondition$;
