set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('public.dispatch_planned_route_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('public.upsert_geofence_v2(jsonb)') is null
    or pg_catalog.to_regclass('public.clients') is null
    or pg_catalog.to_regclass('public.integration_logs') is null then
    raise exception 'address_resolution_tracking_operations_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.clients
  add column if not exists address_geocode_status text not null default 'pending',
  add column if not exists address_lat double precision,
  add column if not exists address_lng double precision,
  add column if not exists address_geocode_hash text,
  add column if not exists address_geocode_provider text,
  add column if not exists address_geocode_accuracy_m double precision,
  add column if not exists address_geocode_confidence double precision,
  add column if not exists address_geocoded_at timestamptz,
  add column if not exists address_geocoded_by uuid,
  add column if not exists address_geocode_audit jsonb not null default '{}'::jsonb;

alter table public.clients
  drop constraint if exists clients_address_geocode_status_check,
  add constraint clients_address_geocode_status_check
    check (address_geocode_status in ('pending','ambiguous','verified','ignored','error')),
  drop constraint if exists clients_address_coordinates_check,
  add constraint clients_address_coordinates_check check (
    (address_lat is null and address_lng is null)
    or (address_lat between -90 and 90 and address_lng between -180 and 180)
  ),
  drop constraint if exists clients_address_geocode_quality_check,
  add constraint clients_address_geocode_quality_check check (
    (address_geocode_accuracy_m is null or address_geocode_accuracy_m between 0 and 100000)
    and (address_geocode_confidence is null or address_geocode_confidence between 0 and 1)
  );

alter table public.dispatch_stops
  add column if not exists location_exception_reason text,
  add column if not exists location_exception_at timestamptz,
  add column if not exists location_exception_by uuid;

alter table public.dispatch_stops
  drop constraint if exists dispatch_stops_location_exception_reason_check,
  add constraint dispatch_stops_location_exception_reason_check
    check (location_exception_reason is null or length(btrim(location_exception_reason)) between 20 and 1000);

alter table public.geofences
  add column if not exists scope_kind text not null default 'fleet',
  add column if not exists dispatch_stop_id uuid,
  add column if not exists radius_policy_key text;

alter table public.geofences
  drop constraint if exists geofences_scope_kind_check,
  add constraint geofences_scope_kind_check check (scope_kind in ('fleet','delivery')),
  drop constraint if exists geofences_scope_reference_check,
  add constraint geofences_scope_reference_check check (
    (scope_kind='fleet' and dispatch_stop_id is null)
    or (scope_kind='delivery' and dispatch_stop_id is not null)
  );

create unique index if not exists uq_dispatch_stops_tenant_id_id
  on public.dispatch_stops(tenant_id,id);
do $constraint$
begin
  if not exists(select 1 from pg_constraint where conname='geofences_dispatch_stop_tenant_fk') then
    alter table public.geofences add constraint geofences_dispatch_stop_tenant_fk
      foreign key(tenant_id,dispatch_stop_id) references public.dispatch_stops(tenant_id,id) on delete cascade;
  end if;
end;
$constraint$;
create unique index if not exists uq_delivery_geofence_per_stop
  on public.geofences(tenant_id,dispatch_stop_id) where dispatch_stop_id is not null;

create table public.address_resolution_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('client')),
  entity_id uuid not null,
  address_snapshot text not null check (length(address_snapshot) between 8 and 1000),
  address_hash text not null,
  status text not null default 'pending' check (status in ('pending','ambiguous','resolved','ignored','error')),
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates)='array'),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  last_error text,
  resolved_lat double precision,
  resolved_lng double precision,
  resolved_provider text,
  resolved_accuracy_m double precision,
  resolved_confidence double precision,
  resolved_at timestamptz,
  resolved_by uuid,
  invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,entity_type,entity_id),
  check ((resolved_lat is null and resolved_lng is null)
    or (resolved_lat between -90 and 90 and resolved_lng between -180 and 180))
);

alter table public.address_resolution_queue
  add constraint address_resolution_queue_client_tenant_fk
  foreign key(tenant_id,entity_id) references public.clients(tenant_id,id) on delete cascade;

create index idx_address_resolution_queue_work
  on public.address_resolution_queue(tenant_id,status,updated_at,entity_type);

create table public.address_geocoding_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  address_hash text not null,
  normalized_address text not null,
  provider text not null,
  candidates jsonb not null check (jsonb_typeof(candidates)='array'),
  expires_at timestamptz not null,
  hit_count bigint not null default 0,
  last_used_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,address_hash,provider)
);
create index idx_address_geocoding_cache_expiry
  on public.address_geocoding_cache(tenant_id,address_hash,expires_at desc);

create table public.geocoding_rate_limits (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 0,
  next_allowed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.geocoding_provider_rate_limits (
  provider text primary key check (length(provider) between 1 and 100),
  next_allowed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.geofence_radius_policies (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('fleet','delivery')),
  category text not null,
  radius_m double precision not null check (radius_m between 50 and 50000),
  enter_margin_m double precision not null default 0 check (enter_margin_m between 0 and 1000),
  exit_margin_m double precision not null default 30 check (exit_margin_m between 0 and 2000),
  transition_confirmations integer not null default 2 check (transition_confirmations between 1 and 10),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key(tenant_id,scope_kind,category)
);

create table public.tenant_tracking_schedules (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  poll_interval_minutes integer not null default 3 check (poll_interval_minutes in (1,3,5,10,15)),
  full_sync_interval_hours integer not null default 6 check (full_sync_interval_hours in (1,3,6,12,24)),
  last_poll_claimed_at timestamptz,
  last_full_claimed_at timestamptz,
  last_finished_at timestamptz,
  last_status text check (last_status is null or last_status in ('success','partial','failed','attention_required')),
  last_error text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);

insert into public.geofence_radius_policies(tenant_id,scope_kind,category,radius_m,enter_margin_m,exit_margin_m,transition_confirmations)
select t.id,p.scope_kind,p.category,p.radius_m,p.enter_margin_m,p.exit_margin_m,p.confirmations
from public.tenants t cross join (values
  ('delivery','delivery',500::double precision,0::double precision,30::double precision,2),
  ('fleet','base',250::double precision,0::double precision,30::double precision,2),
  ('fleet','client',300::double precision,0::double precision,30::double precision,2),
  ('fleet','restricted',500::double precision,0::double precision,50::double precision,2),
  ('fleet','general',300::double precision,0::double precision,30::double precision,2)
) p(scope_kind,category,radius_m,enter_margin_m,exit_margin_m,confirmations)
on conflict do nothing;

insert into public.tenant_tracking_schedules(tenant_id)
select id from public.tenants on conflict do nothing;

create or replace function private.normalized_client_address(_client public.clients)
returns text language sql immutable set search_path=''
as $function$
  select lower(regexp_replace(btrim(concat_ws(', ',nullif(btrim(_client.address_street),''),
    nullif(btrim(_client.address_number),''),nullif(btrim(_client.address_complement),''),
    nullif(btrim(_client.address_neighborhood),''),nullif(btrim(_client.address_city),''),
    nullif(btrim(_client.address_state),''),nullif(btrim(_client.address_zip),''),
    coalesce(nullif(btrim(_client.address_country_name),''),'Brasil'))),'\s+',' ','g'))
$function$;
revoke all on function private.normalized_client_address(public.clients) from public,anon,authenticated,service_role;

create or replace function private.invalidate_client_geocode()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare v_address text;v_changed boolean;
begin
  v_address:=private.normalized_client_address(new);
  if tg_op='INSERT' then
    v_changed:=true;
  else
    v_changed:=row(new.address_street,new.address_number,new.address_complement,new.address_neighborhood,
      new.address_city,new.address_state,new.address_zip,new.address_country_name)
      is distinct from row(old.address_street,old.address_number,old.address_complement,old.address_neighborhood,
        old.address_city,old.address_state,old.address_zip,old.address_country_name);
  end if;
  if v_changed then
    new.address_geocode_hash:=case when length(v_address)>=8 then encode(sha256(convert_to(v_address,'UTF8')),'hex') else null end;
    new.address_geocode_status:=case when length(v_address)>=8 then 'pending' else 'ignored' end;
    new.address_lat:=null;new.address_lng:=null;new.address_geocode_provider:=null;
    new.address_geocode_accuracy_m:=null;new.address_geocode_confidence:=null;
    new.address_geocoded_at:=null;new.address_geocoded_by:=null;
    new.address_geocode_audit:=jsonb_build_object('invalidated_at',clock_timestamp(),'reason','address_changed');
  end if;
  return new;
end;
$function$;
revoke all on function private.invalidate_client_geocode() from public,anon,authenticated,service_role;
drop trigger if exists clients_invalidate_geocode on public.clients;
create trigger clients_invalidate_geocode before insert or update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.invalidate_client_geocode();

create or replace function private.enqueue_client_geocode()
returns trigger language plpgsql security invoker set search_path=''
as $function$
declare v_address text;
begin
  v_address:=private.normalized_client_address(new);
  if new.address_geocode_hash is not null and new.address_geocode_status='pending' then
    insert into public.address_resolution_queue(tenant_id,entity_type,entity_id,address_snapshot,address_hash,status,
      candidates,attempts,last_error,resolved_at,resolved_by,invalidated_at,updated_at)
    values(new.tenant_id,'client',new.id,v_address,new.address_geocode_hash,'pending','[]'::jsonb,0,null,null,null,
      case when tg_op='UPDATE' then clock_timestamp() else null end,clock_timestamp())
    on conflict(tenant_id,entity_type,entity_id) do update set
      address_snapshot=excluded.address_snapshot,address_hash=excluded.address_hash,status='pending',candidates='[]'::jsonb,
      attempts=0,last_error=null,resolved_lat=null,resolved_lng=null,resolved_provider=null,resolved_accuracy_m=null,
      resolved_confidence=null,resolved_at=null,resolved_by=null,invalidated_at=excluded.invalidated_at,updated_at=clock_timestamp();
  end if;
  return null;
end;
$function$;
revoke all on function private.enqueue_client_geocode() from public,anon,authenticated,service_role;
drop trigger if exists clients_enqueue_geocode on public.clients;
create trigger clients_enqueue_geocode after insert or update of address_street,address_number,address_complement,
  address_neighborhood,address_city,address_state,address_zip,address_country_name on public.clients
  for each row execute function private.enqueue_client_geocode();

update public.clients c set address_street=c.address_street,
  address_geocode_hash=encode(sha256(convert_to(private.normalized_client_address(c),'UTF8')),'hex'),
  address_geocode_status='pending',address_lat=null,address_lng=null,address_geocoded_at=null,address_geocoded_by=null,
  address_geocode_audit=jsonb_build_object('invalidated_at',clock_timestamp(),'reason','initial_backfill')
where active and coalesce(length(btrim(address_street)),0)>0 and coalesce(length(btrim(address_city)),0)>0;

create or replace function private.seed_tracking_tenant_defaults()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  insert into public.tenant_tracking_schedules(tenant_id) values(new.id) on conflict do nothing;
  insert into public.geofence_radius_policies(tenant_id,scope_kind,category,radius_m,enter_margin_m,exit_margin_m,transition_confirmations)
  values(new.id,'delivery','delivery',500,0,30,2),(new.id,'fleet','base',250,0,30,2),
    (new.id,'fleet','client',300,0,30,2),(new.id,'fleet','restricted',500,0,50,2),
    (new.id,'fleet','general',300,0,30,2) on conflict do nothing;
  return null;
end;
$function$;
revoke all on function private.seed_tracking_tenant_defaults() from public,anon,authenticated,service_role;
drop trigger if exists seed_tracking_tenant_defaults on public.tenants;
create trigger seed_tracking_tenant_defaults after insert on public.tenants for each row
  execute function private.seed_tracking_tenant_defaults();

create or replace function public.consume_geocoding_quota_v1(_tenant_id uuid,_provider text default 'nominatim')
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_row public.geocoding_rate_limits%rowtype;v_provider_row public.geocoding_provider_rate_limits%rowtype;
  v_now timestamptz:=clock_timestamp();v_provider text:=lower(btrim(coalesce(_provider,'')));
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if length(v_provider) not between 1 and 100 then raise exception 'invalid_geocoding_provider' using errcode='22023';end if;
  insert into public.geocoding_provider_rate_limits(provider) values(v_provider) on conflict do nothing;
  select * into v_provider_row from public.geocoding_provider_rate_limits where provider=v_provider for update;
  insert into public.geocoding_rate_limits(tenant_id) values(_tenant_id) on conflict do nothing;
  select * into v_row from public.geocoding_rate_limits where tenant_id=_tenant_id for update;
  if v_row.window_started_at<=v_now-interval '1 minute' then
    v_row.window_started_at:=v_now;v_row.request_count:=0;
  end if;
  if v_row.request_count>=30 or v_row.next_allowed_at>v_now or v_provider_row.next_allowed_at>v_now then
    return jsonb_build_object('allowed',false,'retry_after_ms',greatest(100,
      ceil(extract(epoch from greatest(v_provider_row.next_allowed_at-v_now,v_row.next_allowed_at-v_now,
        v_row.window_started_at+interval '1 minute'-v_now))*1000)::integer));
  end if;
  update public.geocoding_rate_limits set window_started_at=v_row.window_started_at,request_count=v_row.request_count+1,
    next_allowed_at=v_now+interval '1 second',updated_at=v_now where tenant_id=_tenant_id;
  update public.geocoding_provider_rate_limits set next_allowed_at=v_now+interval '1 second',updated_at=v_now where provider=v_provider;
  return jsonb_build_object('allowed',true,'retry_after_ms',0);
end;
$function$;
revoke all on function public.consume_geocoding_quota_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.consume_geocoding_quota_v1(uuid,text) to service_role;

create or replace function public.resolve_address_queue_item_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_id uuid:=nullif(_payload->>'queue_id','')::uuid;
  v_item public.address_resolution_queue%rowtype;v_lat double precision:=nullif(_payload->>'latitude','')::double precision;
  v_lng double precision:=nullif(_payload->>'longitude','')::double precision;v_provider text:=nullif(_payload->>'provider','');
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if v_lat is null or v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180 or v_provider is null then
    raise exception 'invalid_address_resolution' using errcode='22023';end if;
  select * into v_item from public.address_resolution_queue where id=v_id and tenant_id=v_tenant for update;
  if not found or v_item.status not in ('pending','ambiguous','error') then raise exception 'address_resolution_not_available' using errcode='23514';end if;
  if v_item.entity_type='client' then
    update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
      address_geocode_provider=v_provider,address_geocode_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
      address_geocode_confidence=nullif(_payload->>'confidence','')::double precision,address_geocoded_at=clock_timestamp(),
      address_geocoded_by=auth.uid(),address_geocode_hash=v_item.address_hash,
      address_geocode_audit=jsonb_build_object('queue_id',v_id,'selected_label',_payload->>'label','selection','assisted')
    where id=v_item.entity_id and tenant_id=v_tenant and address_geocode_hash=v_item.address_hash;
    if not found then raise exception 'address_changed_during_resolution' using errcode='40001';end if;
  end if;
  update public.address_resolution_queue set status='resolved',resolved_lat=v_lat,resolved_lng=v_lng,
    resolved_provider=v_provider,resolved_accuracy_m=nullif(_payload->>'accuracy_m','')::double precision,
    resolved_confidence=nullif(_payload->>'confidence','')::double precision,resolved_at=clock_timestamp(),
    resolved_by=auth.uid(),updated_at=clock_timestamp() where id=v_id;
  return jsonb_build_object('ok',true,'queue_id',v_id);
end;
$function$;
revoke all on function public.resolve_address_queue_item_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.resolve_address_queue_item_v1(jsonb) to authenticated;

create or replace function public.get_address_resolution_queue_v1(_tenant_id uuid,_status text default null,_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if _status is not null and _status not in ('pending','ambiguous','resolved','ignored','error') then
    raise exception 'invalid_address_resolution_status' using errcode='22023';end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at,q.id),'[]'::jsonb) into v_result
  from (select r.id,r.tenant_id,r.entity_type,r.entity_id,r.address_snapshot,r.address_hash,r.status,
      r.candidates,r.attempts,r.last_error,r.invalidated_at,r.created_at,r.updated_at,
      c.company_name,c.trade_name
    from public.address_resolution_queue r join public.clients c on c.id=r.entity_id and c.tenant_id=r.tenant_id
    where r.tenant_id=_tenant_id and (_status is null or r.status=_status)
    order by r.updated_at,r.id limit greatest(1,least(coalesce(_limit,100),500))) q;
  return v_result;
end;
$function$;
revoke all on function public.get_address_resolution_queue_v1(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_address_resolution_queue_v1(uuid,text,integer) to authenticated;

create or replace function public.upsert_geofence_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_scope text:=coalesce(nullif(_payload->>'scope_kind',''),'fleet');
  v_category text:=coalesce(nullif(_payload->>'category',''),'general');v_policy public.geofence_radius_policies%rowtype;
  v_effective jsonb;v_id uuid;
begin
  if v_scope<>'fleet' then raise exception 'delivery_geofences_are_generated_from_dispatch_stops' using errcode='22023';end if;
  select * into v_policy from public.geofence_radius_policies where tenant_id=v_tenant and scope_kind=v_scope and category=v_category;
  if not found then select * into v_policy from public.geofence_radius_policies where tenant_id=v_tenant and scope_kind='fleet' and category='general';end if;
  v_effective:=_payload||jsonb_build_object('radius_m',coalesce(nullif(_payload->>'radius_m','')::double precision,v_policy.radius_m,300),
    'enter_margin_m',coalesce(nullif(_payload->>'enter_margin_m','')::double precision,v_policy.enter_margin_m,0),
    'exit_margin_m',coalesce(nullif(_payload->>'exit_margin_m','')::double precision,v_policy.exit_margin_m,30),
    'transition_confirmations',coalesce(nullif(_payload->>'transition_confirmations','')::integer,v_policy.transition_confirmations,2));
  v_id:=public.upsert_geofence_v2(v_effective);
  update public.geofences set scope_kind='fleet',dispatch_stop_id=null,radius_policy_key=v_scope||':'||v_category where id=v_id and tenant_id=v_tenant;
  return v_id;
end;
$function$;
revoke all on function public.upsert_geofence_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upsert_geofence_v3(jsonb) to authenticated;

create or replace function public.dispatch_planned_route_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare v_stop jsonb;v_order integer:=0;v_source text;v_reason text;v_trip uuid;v_db_stop public.dispatch_stops%rowtype;
  v_policy public.geofence_radius_policies%rowtype;v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_geometry extensions.geometry;
begin
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_source:=coalesce(nullif(v_stop->>'location_source',''),'legacy_coordinates');
    v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    if v_source in ('address_geocoded','map_selected') then
      if nullif(v_stop->>'latitude','')::double precision is null
        or nullif(v_stop->>'latitude','')::double precision not between -90 and 90
        or nullif(v_stop->>'longitude','')::double precision is null
        or nullif(v_stop->>'longitude','')::double precision not between -180 and 180 then
        raise exception 'dispatch_verified_location_coordinates_required' using errcode='23514';end if;
    elsif v_reason is null or length(v_reason)<20 then
      raise exception 'dispatch_location_verification_or_exception_required' using errcode='23514';
    end if;
  end loop;
  v_trip:=public.dispatch_planned_route_v2(_payload);
  select * into v_policy from public.geofence_radius_policies where tenant_id=v_tenant and scope_kind='delivery' and category='delivery';
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_order:=v_order+1;v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    select * into v_db_stop from public.dispatch_stops where tenant_id=v_tenant and dispatch_trip_id=v_trip and stop_order=v_order for update;
    if v_reason is not null then
      update public.dispatch_stops set location_exception_reason=v_reason,location_exception_at=clock_timestamp(),location_exception_by=auth.uid()
        where id=v_db_stop.id;
    end if;
    if v_db_stop.latitude is not null and v_db_stop.longitude is not null then
      v_geometry:=extensions.st_buffer(extensions.st_setsrid(extensions.st_makepoint(v_db_stop.longitude,v_db_stop.latitude),4326)::extensions.geography,
        coalesce(v_db_stop.geofence_radius_m,v_policy.radius_m,500))::extensions.geometry;
      insert into public.geofences(tenant_id,name,category,enabled,geometry,shape_kind,source_kind,source_address,center_lat,center_lng,
        radius_m,location_provider,location_accuracy_m,location_confidence,enter_margin_m,exit_margin_m,transition_confirmations,
        location_resolved_at,location_resolved_by,location_audit,scope_kind,dispatch_stop_id,radius_policy_key)
      values(v_tenant,'Entrega '||v_order||' · '||left(v_db_stop.destination,120),'delivery',true,v_geometry,'circle',v_db_stop.location_source,
        v_db_stop.location_address,v_db_stop.latitude,v_db_stop.longitude,coalesce(v_db_stop.geofence_radius_m,v_policy.radius_m,500),
        v_db_stop.location_provider,v_db_stop.location_accuracy_m,v_db_stop.location_confidence,coalesce(v_policy.enter_margin_m,0),
        coalesce(v_policy.exit_margin_m,30),coalesce(v_policy.transition_confirmations,2),v_db_stop.location_resolved_at,
        v_db_stop.location_resolved_by,v_db_stop.location_audit,'delivery',v_db_stop.id,'delivery:delivery')
      on conflict(tenant_id,dispatch_stop_id) where dispatch_stop_id is not null do nothing;
    end if;
  end loop;
  return v_trip;
end;
$function$;
revoke all on function public.dispatch_planned_route_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route_v3(jsonb) to authenticated;

create or replace function public.claim_due_tracking_schedules_v1(_limit integer default 25)
returns table(tenant_id uuid,pipeline_mode text) language plpgsql security invoker set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  return query with due as (
    select s.tenant_id,case when s.last_full_claimed_at is null or s.last_full_claimed_at<=clock_timestamp()-make_interval(hours=>s.full_sync_interval_hours)
      then 'full' else 'poll' end as mode
    from public.tenant_tracking_schedules s
    where s.enabled and (s.last_poll_claimed_at is null or s.last_poll_claimed_at<=clock_timestamp()-make_interval(mins=>s.poll_interval_minutes))
      and exists(select 1 from public.tenant_feature_policy p where p.tenant_id=s.tenant_id and p.feature_key='ssx_enabled' and p.enabled)
      and not exists(select 1 from public.tenant_feature_policy p where p.tenant_id=s.tenant_id and p.feature_key='ssx_kill_switch' and p.enabled)
    order by coalesce(s.last_poll_claimed_at,'-infinity'::timestamptz),s.tenant_id for update skip locked limit greatest(1,least(coalesce(_limit,25),100))
  ), updated as (
    update public.tenant_tracking_schedules s set last_poll_claimed_at=clock_timestamp(),
      last_full_claimed_at=case when due.mode='full' then clock_timestamp() else s.last_full_claimed_at end,updated_at=clock_timestamp()
    from due where s.tenant_id=due.tenant_id returning s.tenant_id,due.mode
  ) select updated.tenant_id,updated.mode from updated;
end;
$function$;
revoke all on function public.claim_due_tracking_schedules_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_due_tracking_schedules_v1(integer) to service_role;

create or replace function public.record_tracking_schedule_result_v1(_tenant_id uuid,_status text,_error text default null)
returns void language plpgsql security invoker set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres') or _status not in ('success','partial','failed','attention_required') then
    raise exception 'not_authorized' using errcode='42501';end if;
  update public.tenant_tracking_schedules set last_finished_at=clock_timestamp(),last_status=_status,last_error=left(_error,2000),
    consecutive_failures=case when _status='success' then 0 else consecutive_failures+1 end,updated_at=clock_timestamp()
    where tenant_id=_tenant_id;
end;
$function$;
revoke all on function public.record_tracking_schedule_result_v1(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_tracking_schedule_result_v1(uuid,text,text) to service_role;

create or replace function public.update_tracking_schedule_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_poll integer:=nullif(_payload->>'poll_interval_minutes','')::integer;
  v_full integer:=nullif(_payload->>'full_sync_interval_hours','')::integer;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
  if v_poll not in (1,3,5,10,15) or v_full not in (1,3,6,12,24) then raise exception 'invalid_tracking_schedule' using errcode='22023';end if;
  insert into public.tenant_tracking_schedules(tenant_id,enabled,poll_interval_minutes,full_sync_interval_hours,updated_by)
  values(v_tenant,coalesce((_payload->>'enabled')::boolean,true),v_poll,v_full,auth.uid())
  on conflict(tenant_id) do update set enabled=excluded.enabled,poll_interval_minutes=excluded.poll_interval_minutes,
    full_sync_interval_hours=excluded.full_sync_interval_hours,updated_at=clock_timestamp(),updated_by=auth.uid();
  return jsonb_build_object('ok',true,'tenant_id',v_tenant);
end;
$function$;
revoke all on function public.update_tracking_schedule_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_tracking_schedule_v1(jsonb) to authenticated;

create or replace function public.get_tracking_observability_v1(_tenant_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
  select jsonb_build_object(
    'positions',jsonb_build_object(
      'fresh',(select count(*) from public.positions_last p where p.tenant_id=_tenant_id and p.captured_at>=clock_timestamp()-interval '10 minutes'),
      'stale',(select count(*) from public.positions_last p where p.tenant_id=_tenant_id and p.captured_at<clock_timestamp()-interval '10 minutes'),
      'last_at',(select max(p.captured_at) from public.positions_last p where p.tenant_id=_tenant_id)),
    'tracker_links',jsonb_build_object(
      'active',(select count(*) from public.vehicle_tracker_links l where l.tenant_id=_tenant_id and l.active),
      'conflicts',(select count(*) from public.dispatch_trips t where t.tenant_id=_tenant_id and t.status in ('in_transit','in_progress') and t.tracker_link_id is null)),
    'geofences',jsonb_build_object(
      'fleet',(select count(*) from public.geofences g where g.tenant_id=_tenant_id and g.scope_kind='fleet' and g.enabled),
      'delivery',(select count(*) from public.geofences g where g.tenant_id=_tenant_id and g.scope_kind='delivery' and g.enabled),
      'events_24h',(select count(*) from public.geofence_events e where e.tenant_id=_tenant_id and e.event_at>=clock_timestamp()-interval '24 hours'),
      'last_evaluated_at',(select max(s.last_checked_at) from public.geofence_states s where s.tenant_id=_tenant_id)),
    'queue',jsonb_build_object('pending',(select count(*) from public.vehicle_processing_queue q where q.tenant_id=_tenant_id and q.processed_at is null),
      'errors',(select count(*) from public.vehicle_processing_queue q where q.tenant_id=_tenant_id and q.last_error is not null)),
    'addresses',jsonb_build_object('pending',(select count(*) from public.address_resolution_queue q where q.tenant_id=_tenant_id and q.status='pending'),
      'ambiguous',(select count(*) from public.address_resolution_queue q where q.tenant_id=_tenant_id and q.status='ambiguous'),
      'error',(select count(*) from public.address_resolution_queue q where q.tenant_id=_tenant_id and q.status='error')),
    'integration',coalesce((select jsonb_build_object('last_at',i.created_at,'success',i.success,'action',i.action,'error',i.error_message)
      from public.integration_logs i where i.tenant_id=_tenant_id and i.action like 'ssx_%' order by i.created_at desc limit 1),'{}'::jsonb),
    'schedule',coalesce((select to_jsonb(s)-'tenant_id' from public.tenant_tracking_schedules s where s.tenant_id=_tenant_id),'{}'::jsonb)
  ) into v_result;
  return coalesce(v_result,'{}'::jsonb);
end;
$function$;
revoke all on function public.get_tracking_observability_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_tracking_observability_v1(uuid) to authenticated;

alter table public.address_resolution_queue enable row level security;
alter table public.address_geocoding_cache enable row level security;
alter table public.geocoding_rate_limits enable row level security;
alter table public.geocoding_provider_rate_limits enable row level security;
alter table public.geofence_radius_policies enable row level security;
alter table public.tenant_tracking_schedules enable row level security;

revoke all on table public.address_resolution_queue,public.address_geocoding_cache,public.geocoding_rate_limits,public.geocoding_provider_rate_limits,
  public.geofence_radius_policies,public.tenant_tracking_schedules from public,anon,authenticated,service_role;
grant select,insert,update on table public.address_resolution_queue to authenticated;
grant select,insert,update on table public.address_resolution_queue to service_role;
grant select,insert,update,delete on table public.address_geocoding_cache,public.geocoding_rate_limits,public.geocoding_provider_rate_limits to service_role;
grant select on table public.geofence_radius_policies,public.tenant_tracking_schedules to authenticated;
grant update on table public.geofence_radius_policies to authenticated;
grant insert,update on table public.tenant_tracking_schedules to authenticated;
grant select,insert,update on table public.geofence_radius_policies,public.tenant_tracking_schedules to service_role;

create policy address_resolution_queue_select on public.address_resolution_queue for select to authenticated
  using (public.is_tenant_admin(tenant_id));
create policy address_resolution_queue_update on public.address_resolution_queue for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy address_resolution_queue_insert on public.address_resolution_queue for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));
create policy geofence_radius_policies_select on public.geofence_radius_policies for select to authenticated
  using (tenant_id in (select public.get_user_tenant_ids()));
create policy geofence_radius_policies_update on public.geofence_radius_policies for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy tenant_tracking_schedules_select on public.tenant_tracking_schedules for select to authenticated
  using (public.is_tenant_admin(tenant_id));
create policy tenant_tracking_schedules_insert on public.tenant_tracking_schedules for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));
create policy tenant_tracking_schedules_update on public.tenant_tracking_schedules for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

do $postcondition$
begin
  if pg_catalog.to_regprocedure('public.dispatch_planned_route_v3(jsonb)') is null
    or pg_catalog.to_regprocedure('public.claim_due_tracking_schedules_v1(integer)') is null
    or pg_catalog.to_regprocedure('public.get_tracking_observability_v1(uuid)') is null
    or not (select relrowsecurity from pg_class where oid='public.address_resolution_queue'::regclass)
    or pg_catalog.has_function_privilege('anon','public.dispatch_planned_route_v3(jsonb)','execute')
    or pg_catalog.has_function_privilege('authenticated','public.claim_due_tracking_schedules_v1(integer)','execute') then
    raise exception 'address_resolution_tracking_operations_postcondition_failed';
  end if;
end;
$postcondition$;
