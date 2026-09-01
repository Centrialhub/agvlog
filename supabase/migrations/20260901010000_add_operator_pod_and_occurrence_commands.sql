-- Operator POD history and recoverable operational-event commands.
-- Database-only bookkeeping: no fiscal provider, tracking provider or paid API call.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
declare
  required_object text;
begin
  if to_regclass('public.operational_event_commands') is not null
    or to_regprocedure('public.get_operator_pod_history_v1(uuid,uuid)') is not null
    or to_regprocedure('public.create_operational_event_v1(jsonb)') is not null
    or to_regprocedure('public.resolve_operational_event_v1(jsonb)') is not null then
    raise exception 'Operator POD/occurrence migration is already installed';
  end if;

  foreach required_object in array array[
    'public.operational_events', 'public.operational_event_messages',
    'public.client_occurrence_messages', 'public.fiscal_documents',
    'public.delivery_attempts', 'public.delivery_document_outcomes',
    'public.delivery_document_corrections',
    'public.active_delivery_document_outcomes', 'public.proof_of_delivery',
    'public.current_delivery_proofs', 'public.available_delivery_proofs',
    'public.dispatch_stop_documents', 'public.dispatch_stops',
    'public.dispatch_trips', 'public.dispatch_trip_loads', 'public.load_items',
    'public.loads', 'public.orders', 'public.vehicles', 'public.drivers',
    'public.clients', 'public.tenants', 'public.tenant_memberships'
  ] loop
    if to_regclass(required_object) is null then
      raise exception 'Operator POD/occurrence dependency is missing: %', required_object;
    end if;
  end loop;

  if to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null then
    raise exception 'Operator POD/occurrence authorization or audit dependency is missing';
  end if;
end;
$guard$;

-- Fail closed before replacing the legacy single-column references. A UUID may
-- exist globally while still belonging to another tenant.
do $tenant_graph$
declare
  violations bigint;
begin
  select coalesce(sum(invalid), 0)
  into violations
  from (
    select count(*) filter (where e.load_id is not null and l.id is null) invalid
      from public.operational_events e left join public.loads l on l.tenant_id=e.tenant_id and l.id=e.load_id
    union all select count(*) filter (where e.order_id is not null and o.id is null)
      from public.operational_events e left join public.orders o on o.tenant_id=e.tenant_id and o.id=e.order_id
    union all select count(*) filter (where e.vehicle_id is not null and v.id is null)
      from public.operational_events e left join public.vehicles v on v.tenant_id=e.tenant_id and v.id=e.vehicle_id
    union all select count(*) filter (where e.driver_id is not null and d.id is null)
      from public.operational_events e left join public.drivers d on d.tenant_id=e.tenant_id and d.id=e.driver_id
    union all select count(*) filter (where e.client_id is not null and c.id is null)
      from public.operational_events e left join public.clients c on c.tenant_id=e.tenant_id and c.id=e.client_id
    union all select count(*) filter (where e.dispatch_trip_id is not null and t.id is null)
      from public.operational_events e left join public.dispatch_trips t on t.tenant_id=e.tenant_id and t.id=e.dispatch_trip_id
    union all select count(*) filter (where e.dispatch_stop_id is not null and s.id is null)
      from public.operational_events e left join public.dispatch_stops s on s.tenant_id=e.tenant_id and s.id=e.dispatch_stop_id
    union all select count(*) filter (where e.fiscal_document_id is not null and f.id is null)
      from public.operational_events e left join public.fiscal_documents f on f.tenant_id=e.tenant_id and f.id=e.fiscal_document_id
    union all select count(*) filter (where e.proof_of_delivery_id is not null and p.id is null)
      from public.operational_events e left join public.proof_of_delivery p on p.tenant_id=e.tenant_id and p.id=e.proof_of_delivery_id
    union all select count(*) filter (where e.id is null)
      from public.client_occurrence_messages m left join public.operational_events e on e.tenant_id=m.tenant_id and e.id=m.occurrence_id
    union all select count(*) filter (where e.id is null)
      from public.operational_event_messages m left join public.operational_events e on e.tenant_id=m.tenant_id and e.id=m.event_id
  ) checks;
  if violations > 0 then
    raise exception 'Operational-event tenant graph contains % invalid reference(s)', violations;
  end if;
end;
$tenant_graph$;

create unique index if not exists loads_tenant_id_id_uidx on public.loads(tenant_id,id);
create unique index if not exists orders_tenant_id_id_uidx on public.orders(tenant_id,id);
create unique index if not exists vehicles_tenant_id_id_uidx on public.vehicles(tenant_id,id);
create unique index if not exists drivers_tenant_id_id_uidx on public.drivers(tenant_id,id);
create unique index if not exists clients_tenant_id_id_uidx on public.clients(tenant_id,id);
create unique index if not exists dispatch_trips_tenant_id_id_uidx on public.dispatch_trips(tenant_id,id);
create unique index if not exists dispatch_stops_tenant_id_id_uidx on public.dispatch_stops(tenant_id,id);
create unique index if not exists fiscal_documents_tenant_id_id_uidx on public.fiscal_documents(tenant_id,id);
create unique index if not exists proof_of_delivery_tenant_id_id_uidx on public.proof_of_delivery(tenant_id,id);
create unique index if not exists operational_events_tenant_id_id_uidx on public.operational_events(tenant_id,id);

do $message_scope$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_occurrence_messages'::regclass
    and conname='client_occurrence_message_event_scope_fkey') then
    alter table public.client_occurrence_messages add constraint client_occurrence_message_event_scope_fkey
      foreign key(tenant_id,occurrence_id) references public.operational_events(tenant_id,id) on delete cascade not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.operational_event_messages'::regclass
    and conname='event_chat_event_scope_fkey') then
    alter table public.operational_event_messages add constraint event_chat_event_scope_fkey
      foreign key(tenant_id,event_id) references public.operational_events(tenant_id,id) on delete restrict not valid;
  end if;
end;
$message_scope$;
alter table public.client_occurrence_messages validate constraint client_occurrence_message_event_scope_fkey;
alter table public.operational_event_messages validate constraint event_chat_event_scope_fkey;

alter table public.operational_events
  drop constraint if exists operational_events_load_id_fkey,
  drop constraint if exists operational_events_order_id_fkey,
  drop constraint if exists operational_events_vehicle_id_fkey,
  drop constraint if exists operational_events_driver_id_fkey,
  drop constraint if exists operational_events_client_id_fkey,
  drop constraint if exists operational_events_dispatch_trip_id_fkey,
  drop constraint if exists operational_events_dispatch_stop_id_fkey,
  drop constraint if exists operational_events_fiscal_document_id_fkey,
  drop constraint if exists operational_events_proof_of_delivery_id_fkey,
  add constraint operational_events_load_tenant_fkey foreign key(tenant_id,load_id)
    references public.loads(tenant_id,id) not valid,
  add constraint operational_events_order_tenant_fkey foreign key(tenant_id,order_id)
    references public.orders(tenant_id,id) not valid,
  add constraint operational_events_vehicle_tenant_fkey foreign key(tenant_id,vehicle_id)
    references public.vehicles(tenant_id,id) not valid,
  add constraint operational_events_driver_tenant_fkey foreign key(tenant_id,driver_id)
    references public.drivers(tenant_id,id) not valid,
  add constraint operational_events_client_tenant_fkey foreign key(tenant_id,client_id)
    references public.clients(tenant_id,id) not valid,
  add constraint operational_events_trip_tenant_fkey foreign key(tenant_id,dispatch_trip_id)
    references public.dispatch_trips(tenant_id,id) on delete set null (dispatch_trip_id) not valid,
  add constraint operational_events_stop_tenant_fkey foreign key(tenant_id,dispatch_stop_id)
    references public.dispatch_stops(tenant_id,id) on delete set null (dispatch_stop_id) not valid,
  add constraint operational_events_document_tenant_fkey foreign key(tenant_id,fiscal_document_id)
    references public.fiscal_documents(tenant_id,id) on delete set null (fiscal_document_id) not valid,
  add constraint operational_events_proof_tenant_fkey foreign key(tenant_id,proof_of_delivery_id)
    references public.proof_of_delivery(tenant_id,id) on delete set null (proof_of_delivery_id) not valid;

alter table public.operational_events validate constraint operational_events_load_tenant_fkey;
alter table public.operational_events validate constraint operational_events_order_tenant_fkey;
alter table public.operational_events validate constraint operational_events_vehicle_tenant_fkey;
alter table public.operational_events validate constraint operational_events_driver_tenant_fkey;
alter table public.operational_events validate constraint operational_events_client_tenant_fkey;
alter table public.operational_events validate constraint operational_events_trip_tenant_fkey;
alter table public.operational_events validate constraint operational_events_stop_tenant_fkey;
alter table public.operational_events validate constraint operational_events_document_tenant_fkey;
alter table public.operational_events validate constraint operational_events_proof_tenant_fkey;

create table public.operational_event_commands(
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_id uuid not null,
  request_id uuid not null,
  action text not null check(action in('create','resolve')),
  event_id uuid not null,
  reason text not null check(length(btrim(reason)) between 5 and 4000),
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,id),
  unique(tenant_id,actor_id,request_id),
  foreign key(tenant_id,event_id) references public.operational_events(tenant_id,id) on delete restrict
);
create index operational_event_commands_event_idx
  on public.operational_event_commands(tenant_id,event_id,created_at desc,id);
alter table public.operational_event_commands enable row level security;
revoke all on public.operational_event_commands from public,anon,authenticated,service_role;
grant select on public.operational_event_commands to authenticated;
create policy operational_event_command_operator_read on public.operational_event_commands
  for select to authenticated using(
    (select auth.uid()) is not null and public.is_tenant_operator_or_admin(tenant_id)
  );

create function public._preserve_operational_event_command()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  raise exception 'operational_event_command_history_is_append_only' using errcode='55000';
end;
$fn$;
revoke all on function public._preserve_operational_event_command() from public,anon,authenticated,service_role;
create trigger operational_event_commands_append_only
  before update or delete on public.operational_event_commands
  for each row execute function public._preserve_operational_event_command();

-- Keep the still-deployed direct resolver portal-safe until its frontend
-- cutover. This does not grant or revoke any table/RPC privilege.
create function public._normalize_operational_event_resolution()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  if new.resolved_at is not null then
    new.public_status := 'resolved';
    new.client_action_required := false;
  end if;
  if tg_op='INSERT' then
    new.created_at := coalesce(new.created_at,clock_timestamp());
    new.updated_at := coalesce(new.updated_at,new.created_at);
  elsif (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$fn$;
revoke all on function public._normalize_operational_event_resolution() from public,anon,authenticated,service_role;
create trigger normalize_operational_event_resolution
  before insert or update on public.operational_events
  for each row execute function public._normalize_operational_event_resolution();

-- The portal reply RPC inserts before it updates the occurrence. Lock the
-- occurrence at insert time so a reply cannot race a resolution or appear on a
-- lifecycle that has already closed.
create function public._guard_client_occurrence_message_lifecycle()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
declare v_resolved timestamptz;
begin
  select resolved_at into v_resolved from public.operational_events
    where tenant_id=new.tenant_id and id=new.occurrence_id for update nowait;
  if not found then raise exception 'client_occurrence_message_invalid_scope' using errcode='23514';end if;
  if v_resolved is not null then raise exception 'client_occurrence_message_lifecycle_closed' using errcode='23514';end if;
  return new;
exception when lock_not_available or deadlock_detected then
  raise exception 'client_occurrence_message_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public._guard_client_occurrence_message_lifecycle() from public,anon,authenticated,service_role;
create trigger guard_client_occurrence_message_lifecycle
  before insert on public.client_occurrence_messages
  for each row execute function public._guard_client_occurrence_message_lifecycle();

-- Repair already-resolved rows once, with one audit record per changed event.
do $resolution_backfill$
declare r record;v_after jsonb;
begin
  for r in select e.id,e.tenant_id,to_jsonb(e) before_snapshot from public.operational_events e
    where e.resolved_at is not null and (e.public_status is distinct from 'resolved' or e.client_action_required)
    order by e.tenant_id,e.id for update
  loop
    update public.operational_events set public_status='resolved',client_action_required=false where id=r.id and tenant_id=r.tenant_id;
    select to_jsonb(e) into strict v_after from public.operational_events e where e.id=r.id and e.tenant_id=r.tenant_id;
    perform public._log_entity_audit(r.tenant_id,'operational_event',r.id,'repair_public_resolution',r.before_snapshot,
      v_after,'operator_event_resolution_backfill');
  end loop;
end;
$resolution_backfill$;

create function public._operational_event_binding_snapshot(
  _tenant uuid,
  _bindings jsonb,
  _lock boolean default false
)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare
  v_allowed constant text[] := array['load_id','order_id','vehicle_id','driver_id','client_id',
    'dispatch_trip_id','dispatch_stop_id','fiscal_document_id','proof_of_delivery_id'];
  v_load uuid;v_order uuid;v_vehicle uuid;v_driver uuid;v_client uuid;v_trip uuid;v_stop uuid;v_doc uuid;v_proof uuid;
  v_derived_client uuid;v_candidate_client uuid;v jsonb;v_refs jsonb:='{}';v_normalized jsonb;
begin
  if _tenant is null or _bindings is null or jsonb_typeof(_bindings)<>'object'
    or octet_length(_bindings::text)>4096
    or exists(select 1 from jsonb_each(_bindings) b where not(b.key=any(v_allowed)))
    or exists(select 1 from jsonb_each(_bindings) b where jsonb_typeof(b.value) not in('string','null'))
    or exists(select 1 from jsonb_each_text(_bindings) b where b.value is not null
      and b.value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'operational_event_invalid_bindings' using errcode='22023';
  end if;
  v_load:=(_bindings->>'load_id')::uuid;v_order:=(_bindings->>'order_id')::uuid;
  v_vehicle:=(_bindings->>'vehicle_id')::uuid;v_driver:=(_bindings->>'driver_id')::uuid;
  v_client:=(_bindings->>'client_id')::uuid;v_trip:=(_bindings->>'dispatch_trip_id')::uuid;
  v_stop:=(_bindings->>'dispatch_stop_id')::uuid;v_doc:=(_bindings->>'fiscal_document_id')::uuid;
  v_proof:=(_bindings->>'proof_of_delivery_id')::uuid;

  if v_load is not null then
    v:=null;if _lock then select to_jsonb(l) into v from public.loads l where l.tenant_id=_tenant and l.id=v_load for share of l nowait;
    else select to_jsonb(l) into v from public.loads l where l.tenant_id=_tenant and l.id=v_load;end if;
    if v is null then raise exception 'operational_event_binding_not_found: load' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('load',jsonb_build_object('id',v->'id','status',v->'status','trip_id',v->'trip_id','updated_at',v->'updated_at'));
  end if;
  if v_order is not null then
    v:=null;if _lock then select to_jsonb(o) into v from public.orders o where o.tenant_id=_tenant and o.id=v_order for share of o nowait;
    else select to_jsonb(o) into v from public.orders o where o.tenant_id=_tenant and o.id=v_order;end if;
    if v is null then raise exception 'operational_event_binding_not_found: order' using errcode='23514';end if;
    v_candidate_client:=(v->>'client_id')::uuid;
    v_refs:=v_refs||jsonb_build_object('order',jsonb_build_object('id',v->'id','status',v->'status','client_id',v->'client_id','updated_at',v->'updated_at'));
  end if;
  if v_vehicle is not null then
    v:=null;if _lock then select to_jsonb(x) into v from public.vehicles x where x.tenant_id=_tenant and x.id=v_vehicle for share of x nowait;
    else select to_jsonb(x) into v from public.vehicles x where x.tenant_id=_tenant and x.id=v_vehicle;end if;
    if v is null then raise exception 'operational_event_binding_not_found: vehicle' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('vehicle',jsonb_build_object('id',v->'id','active',v->'active','updated_at',v->'updated_at'));
  end if;
  if v_driver is not null then
    v:=null;if _lock then select to_jsonb(d) into v from public.drivers d where d.tenant_id=_tenant and d.id=v_driver for share of d nowait;
    else select to_jsonb(d) into v from public.drivers d where d.tenant_id=_tenant and d.id=v_driver;end if;
    if v is null then raise exception 'operational_event_binding_not_found: driver' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('driver',jsonb_build_object('id',v->'id','active',v->'active','updated_at',v->'updated_at'));
  end if;
  if v_trip is not null then
    v:=null;if _lock then select to_jsonb(t) into v from public.dispatch_trips t where t.tenant_id=_tenant and t.id=v_trip for share of t nowait;
    else select to_jsonb(t) into v from public.dispatch_trips t where t.tenant_id=_tenant and t.id=v_trip;end if;
    if v is null then raise exception 'operational_event_binding_not_found: trip' using errcode='23514';end if;
    if v_driver is not null and (v->>'driver_id')::uuid is distinct from v_driver then raise exception 'operational_event_binding_conflict: driver_trip' using errcode='23514';end if;
    if v_vehicle is not null and (v->>'vehicle_id')::uuid is distinct from v_vehicle then raise exception 'operational_event_binding_conflict: vehicle_trip' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('trip',jsonb_build_object('id',v->'id','status',v->'status','driver_id',v->'driver_id','vehicle_id',v->'vehicle_id','updated_at',v->'updated_at'));
  end if;
  if v_stop is not null then
    v:=null;if _lock then select to_jsonb(s) into v from public.dispatch_stops s where s.tenant_id=_tenant and s.id=v_stop for share of s nowait;
    else select to_jsonb(s) into v from public.dispatch_stops s where s.tenant_id=_tenant and s.id=v_stop;end if;
    if v is null then raise exception 'operational_event_binding_not_found: stop' using errcode='23514';end if;
    if v_trip is not null and (v->>'dispatch_trip_id')::uuid is distinct from v_trip then raise exception 'operational_event_binding_conflict: stop_trip' using errcode='23514';end if;
    if v_candidate_client is not null and (v->>'client_id')::uuid is not null and (v->>'client_id')::uuid is distinct from v_candidate_client then raise exception 'operational_event_binding_conflict: clients' using errcode='23514';end if;
    v_candidate_client:=coalesce(v_candidate_client,(v->>'client_id')::uuid);
    v_refs:=v_refs||jsonb_build_object('stop',jsonb_build_object('id',v->'id','status',v->'status','trip_id',v->'dispatch_trip_id','client_id',v->'client_id','updated_at',v->'updated_at'));
  end if;
  if v_doc is not null then
    v:=null;if _lock then select to_jsonb(f) into v from public.fiscal_documents f where f.tenant_id=_tenant and f.id=v_doc for share of f nowait;
    else select to_jsonb(f) into v from public.fiscal_documents f where f.tenant_id=_tenant and f.id=v_doc;end if;
    if v is null then raise exception 'operational_event_binding_not_found: document' using errcode='23514';end if;
    if v_candidate_client is not null and (v->>'client_id')::uuid is not null and (v->>'client_id')::uuid is distinct from v_candidate_client then raise exception 'operational_event_binding_conflict: clients' using errcode='23514';end if;
    v_candidate_client:=coalesce(v_candidate_client,(v->>'client_id')::uuid);
    if v_load is not null and not exists(
      select 1 from public.load_items i where i.tenant_id=_tenant and i.load_id=v_load and i.fiscal_document_id=v_doc
      union all select 1 from public.dispatch_stop_documents a where a.tenant_id=_tenant and a.load_id=v_load and a.fiscal_document_id=v_doc
      union all select 1 from public.delivery_document_outcomes h where h.tenant_id=_tenant and h.load_id=v_load and h.fiscal_document_id=v_doc
    ) then raise exception 'operational_event_binding_conflict: document_load' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('document',jsonb_build_object('id',v->'id','status',v->'status','load_id',v->'load_id','client_id',v->'client_id','current_attempt_id',v->'current_delivery_attempt_id','updated_at',v->'updated_at','deleted_at',v->'deleted_at'));
  end if;
  if v_proof is not null then
    if v_doc is null then raise exception 'operational_event_binding_conflict: proof_requires_document' using errcode='23514';end if;
    v:=null;if _lock then select to_jsonb(p) into v from public.proof_of_delivery p where p.tenant_id=_tenant and p.id=v_proof for share of p nowait;
    else select to_jsonb(p) into v from public.proof_of_delivery p where p.tenant_id=_tenant and p.id=v_proof;end if;
    if v is null then raise exception 'operational_event_binding_not_found: proof' using errcode='23514';end if;
    if v_doc is not null and (v->>'fiscal_document_id')::uuid is distinct from v_doc then raise exception 'operational_event_binding_conflict: proof_document' using errcode='23514';end if;
    if v_stop is not null and (v->>'dispatch_stop_id')::uuid is distinct from v_stop then raise exception 'operational_event_binding_conflict: proof_stop' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('proof',jsonb_build_object('id',v->'id','document_id',v->'fiscal_document_id','stop_id',v->'dispatch_stop_id','status',v->'status','version',v->'version','is_active',v->'is_active','updated_at',v->'updated_at'));
  end if;

  v_derived_client:=coalesce(v_client,v_candidate_client);
  if v_client is not null and v_candidate_client is not null and v_client is distinct from v_candidate_client then raise exception 'operational_event_binding_conflict: clients' using errcode='23514';end if;
  if v_derived_client is not null then
    v:=null;if _lock then select to_jsonb(c) into v from public.clients c where c.tenant_id=_tenant and c.id=v_derived_client for share of c nowait;
    else select to_jsonb(c) into v from public.clients c where c.tenant_id=_tenant and c.id=v_derived_client;end if;
    if v is null then raise exception 'operational_event_binding_not_found: client' using errcode='23514';end if;
    v_refs:=v_refs||jsonb_build_object('client',jsonb_build_object('id',v->'id','active',v->'active','updated_at',v->'updated_at'));
  end if;

  if v_trip is not null and v_load is not null and not exists(
    select 1 from public.dispatch_trip_loads x where x.tenant_id=_tenant and x.dispatch_trip_id=v_trip and x.load_id=v_load
  ) then raise exception 'operational_event_binding_conflict: trip_load' using errcode='23514';end if;
  if v_stop is not null and v_doc is not null and not exists(
    select 1 from public.dispatch_stop_documents x where x.tenant_id=_tenant and x.dispatch_stop_id=v_stop and x.fiscal_document_id=v_doc
  ) then raise exception 'operational_event_binding_conflict: stop_document' using errcode='23514';end if;

  v_normalized:=jsonb_strip_nulls(jsonb_build_object('load_id',v_load,'order_id',v_order,'vehicle_id',v_vehicle,
    'driver_id',v_driver,'client_id',v_derived_client,'dispatch_trip_id',v_trip,'dispatch_stop_id',v_stop,
    'fiscal_document_id',v_doc,'proof_of_delivery_id',v_proof));
  return jsonb_build_object('version',1,'tenant_id',_tenant,'bindings',v_normalized,'references',v_refs);
exception when lock_not_available then
  raise exception 'operational_event_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public._operational_event_binding_snapshot(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.get_operational_event_create_context(_tenant_id uuid,_bindings jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_context jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'operational_event_not_authorized' using errcode='42501';end if;
  v_context:=public._operational_event_binding_snapshot(_tenant_id,_bindings,false);
  return (v_context-'references')||jsonb_build_object('actor_id',auth.uid(),
    'revision',encode(sha256(convert_to(v_context::text,'UTF8')),'hex'));
end;
$fn$;

create function public._operational_event_snapshot(_tenant uuid,_event uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare e public.operational_events%rowtype;v_client_messages jsonb;v_event_messages jsonb;
begin
  select * into e from public.operational_events where tenant_id=_tenant and id=_event;
  if not found then raise exception 'operational_event_not_found' using errcode='23514';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'author_role',m.author_role,'message',m.message,'created_at',m.created_at) order by m.created_at,m.id),'[]')
    into v_client_messages from public.client_occurrence_messages m where m.tenant_id=_tenant and m.occurrence_id=_event;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender_role',m.sender_role,'message',m.message,'created_at',m.created_at) order by m.created_at,m.id),'[]')
    into v_event_messages from public.operational_event_messages m where m.tenant_id=_tenant and m.event_id=_event;
  return jsonb_build_object('event',to_jsonb(e),'client_messages',v_client_messages,'event_messages',v_event_messages);
end;
$fn$;
revoke all on function public._operational_event_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_operational_event_context(_tenant_id uuid,_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_context jsonb;v_event jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'operational_event_not_authorized' using errcode='42501';end if;
  v_context:=public._operational_event_snapshot(_tenant_id,_event_id);v_event:=v_context->'event';
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'event_id',_event_id,
    'event',v_event,'can_resolve',(v_event->>'resolved_at') is null,
    'client_message_count',jsonb_array_length(v_context->'client_messages'),
    'event_message_count',jsonb_array_length(v_context->'event_messages'),
    'revision',encode(sha256(convert_to(v_context::text,'UTF8')),'hex'));
end;
$fn$;

create function public.get_operator_pod_history_v1(_tenant_id uuid,_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare f public.fiscal_documents%rowtype;v_current public.delivery_document_outcomes%rowtype;v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'pod_history_not_authorized' using errcode='42501';end if;
  select * into f from public.fiscal_documents where tenant_id=_tenant_id and id=_document_id and deleted_at is null;
  if not found then raise exception 'pod_history_document_not_found' using errcode='23514';end if;
  select * into v_current from public.active_delivery_document_outcomes h
    where h.tenant_id=_tenant_id and h.fiscal_document_id=f.id
      and h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id
    order by h.recorded_at desc,h.id desc limit 1;

  v_result:=jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'document_id',f.id,
    'document',jsonb_build_object('id',f.id,'document_type',f.document_type,'invoice_number',f.invoice_number,
      'status',f.status,'load_id',f.load_id,'client_id',f.client_id,'current_delivery_attempt_id',f.current_delivery_attempt_id,
      'updated_at',f.updated_at),
    'canonical_state',case when v_current.id is not null then v_current.outcome
      when f.current_delivery_attempt_id is not null then 'pending_redelivery' else 'pending' end,
    'delivered',coalesce(v_current.outcome='delivered',false),
    'proof_available',exists(select 1 from public.available_delivery_proofs p where p.tenant_id=_tenant_id and p.fiscal_document_id=f.id),
    'arrival_without_outcome',v_current.id is null and exists(
      select 1 from public.dispatch_stop_documents a join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id
      where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id and s.actual_arrival_at is not null),
    'current_outcome',case when v_current.id is null then null else jsonb_build_object('id',v_current.id,'attempt_id',v_current.delivery_attempt_id,
      'outcome',v_current.outcome,'source',v_current.source,'load_id',v_current.load_id,'trip_id',v_current.dispatch_trip_id,
      'stop_id',v_current.dispatch_stop_id,'occurred_at',v_current.occurred_at,'recorded_at',v_current.recorded_at,'reason',v_current.reason) end,
    'attempts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_attempt_id',a.previous_attempt_id,
      'previous_outcome_id',a.previous_outcome_id,'source_allocation_id',a.source_allocation_id,'event_id',a.event_id,
      'actor_id',a.actor_id,'reason',a.reason,'recorded_at',a.recorded_at,'is_current',a.id=f.current_delivery_attempt_id)
      order by a.recorded_at,a.id) from public.delivery_attempts a where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id),'[]'),
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'attempt_id',h.delivery_attempt_id,'outcome',h.outcome,
      'source',h.source,'load_id',h.load_id,'trip_id',h.dispatch_trip_id,'stop_id',h.dispatch_stop_id,
      'allocation_id',h.dispatch_stop_document_id,'event_id',h.event_id,'occurred_at',h.occurred_at,'recorded_at',h.recorded_at,
      'reason',h.reason,'is_current',h.id=v_current.id,'superseded_by',c.corrected_outcome_id) order by h.recorded_at,h.id)
      from public.delivery_document_outcomes h left join public.delivery_document_corrections c on c.previous_outcome_id=h.id
      where h.tenant_id=_tenant_id and h.fiscal_document_id=f.id),'[]'),
    'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'status',p.status,
      'proof_type',p.proof_type,'load_id',p.load_id,'trip_id',p.dispatch_trip_id,'stop_id',p.dispatch_stop_id,
      'is_active',p.is_active,'retired_event_id',p.retired_event_id,'retired_at',p.retired_at,
      'storage_bucket',p.storage_bucket,'storage_path',p.storage_path,'photo_url',p.photo_url,'signature_url',p.signature_url,
      'receiver_name',p.receiver_name,'receiver_document',p.receiver_document,'received_at',p.received_at,
      'created_at',p.created_at,'updated_at',p.updated_at) order by p.version,p.id)
      from public.proof_of_delivery p where p.tenant_id=_tenant_id and p.fiscal_document_id=f.id),'[]'),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'attempt_id',a.delivery_attempt_id,'load_id',a.load_id,
      'stop_id',s.id,'stop_status',s.status,'destination',s.destination,'actual_arrival_at',s.actual_arrival_at,
      'actual_departure_at',s.actual_departure_at,'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,
      'is_current',a.delivery_attempt_id is not distinct from f.current_delivery_attempt_id) order by t.actual_start_at nulls first,s.id,a.id)
      from public.dispatch_stop_documents a join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id
      join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
      where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id),'[]'),
    'occurrences',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'severity',e.severity,
      'description',e.description,'visible_to_client',e.visible_to_client,'client_action_required',e.client_action_required,
      'public_status',e.public_status,'resolved_at',e.resolved_at,'created_at',e.created_at,'updated_at',e.updated_at)
      order by e.created_at,e.id) from public.operational_events e where e.tenant_id=_tenant_id and (
        e.fiscal_document_id=f.id or e.proof_of_delivery_id in(select p.id from public.proof_of_delivery p where p.tenant_id=_tenant_id and p.fiscal_document_id=f.id)
        or e.dispatch_stop_id in(select a.dispatch_stop_id from public.dispatch_stop_documents a where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id)
      )),'[]')
  );
  return v_result||jsonb_build_object('actor_id',auth.uid(),'revision',encode(sha256(convert_to(v_result::text,'UTF8')),'hex'));
end;
$fn$;

create function public.create_operational_event_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_request uuid;v_event uuid:=gen_random_uuid();v_command uuid:=gen_random_uuid();
 v_type text;v_severity text;v_description text;v_hash text;v_expected text;v_context jsonb;v_after jsonb;v_response jsonb;
 v_bindings jsonb;v_normalized jsonb;v_visible boolean;v_client_action boolean;v_impact bigint;v_existing public.operational_event_commands%rowtype;
begin
  if _payload is null or jsonb_typeof(_payload)<>'object' or octet_length(_payload::text)>16000
    or _payload->'version' is distinct from '1'::jsonb
    or (_payload-array['version','tenant_id','actor_id','request_id','expected_revision','event_type','severity','description',
      'financial_impact_cents','visible_to_client','client_action_required','bindings'])<>'{}'::jsonb then raise exception 'operational_event_invalid_payload' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(_payload) p where p.key in('tenant_id','actor_id','request_id','expected_revision','event_type','severity','description') and jsonb_typeof(p.value)<>'string')
    or (_payload?'financial_impact_cents' and jsonb_typeof(_payload->'financial_impact_cents')<>'number')
    or (_payload?'visible_to_client' and jsonb_typeof(_payload->'visible_to_client')<>'boolean')
    or (_payload?'client_action_required' and jsonb_typeof(_payload->'client_action_required')<>'boolean') then raise exception 'operational_event_invalid_payload' using errcode='22023';end if;
  v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_expected:=_payload->>'expected_revision';
  v_type:=btrim(_payload->>'event_type');v_severity:=_payload->>'severity';v_description:=btrim(_payload->>'description');
  v_bindings:=coalesce(_payload->'bindings','{}');v_visible:=coalesce((_payload->>'visible_to_client')::boolean,false);
  v_client_action:=coalesce((_payload->>'client_action_required')::boolean,false);v_impact:=coalesce((_payload->>'financial_impact_cents')::numeric,0);
  if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or v_tenant is null or v_request is null
    or v_expected!~'^[0-9a-f]{64}$' or v_type!~'^[a-z][a-z0-9_]{1,63}$' or v_severity not in('low','medium','high','critical')
    or length(v_description) not between 5 and 4000 or v_impact<0 or v_impact>99999999999999 or v_impact<>trunc(v_impact)
    or (v_client_action and not v_visible) then raise exception 'operational_event_invalid_payload' using errcode='22023';end if;
  perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
  if not found or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'operational_event_not_authorized' using errcode='42501';end if;
  v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtext('operational-event-command'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
  select * into v_existing from public.operational_event_commands where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
  if found then
    if v_existing.action<>'create' or v_existing.payload_hash<>v_hash then raise exception 'operational_event_request_key_mismatch' using errcode='22023';end if;
    return v_existing.response;
  end if;
  v_context:=public._operational_event_binding_snapshot(v_tenant,v_bindings,true);
  if encode(sha256(convert_to(v_context::text,'UTF8')),'hex')<>v_expected then raise exception 'operational_event_context_changed' using errcode='40001';end if;
  v_normalized:=v_context->'bindings';
  if v_visible and not(v_normalized?'client_id') then raise exception 'operational_event_visible_requires_client' using errcode='23514';end if;
  insert into public.operational_events(id,tenant_id,load_id,order_id,vehicle_id,driver_id,client_id,dispatch_trip_id,dispatch_stop_id,
    fiscal_document_id,proof_of_delivery_id,event_type,severity,description,financial_impact,visible_to_client,client_action_required,
    client_opened,public_status,payload,created_by,created_at,updated_at)
  values(v_event,v_tenant,(v_normalized->>'load_id')::uuid,(v_normalized->>'order_id')::uuid,(v_normalized->>'vehicle_id')::uuid,
    (v_normalized->>'driver_id')::uuid,(v_normalized->>'client_id')::uuid,(v_normalized->>'dispatch_trip_id')::uuid,
    (v_normalized->>'dispatch_stop_id')::uuid,(v_normalized->>'fiscal_document_id')::uuid,(v_normalized->>'proof_of_delivery_id')::uuid,
    v_type,v_severity,v_description,v_impact::numeric/100,v_visible,v_client_action,false,
    case when v_visible then 'open' else 'reported_by_operator' end,
    jsonb_build_object('source','create_operational_event_v1','request_id',v_request,'command_id',v_command),v_actor,clock_timestamp(),clock_timestamp());
  v_after:=public._operational_event_snapshot(v_tenant,v_event);
  v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'command_id',v_command,
    'event_id',v_event,'action','create','confirmed',true,'public_status',v_after#>>'{event,public_status}',
    'revision',encode(sha256(convert_to(v_after::text,'UTF8')),'hex'));
  insert into public.operational_event_commands(id,tenant_id,actor_id,request_id,action,event_id,reason,payload_hash,before_snapshot,after_snapshot,response)
    values(v_command,v_tenant,v_actor,v_request,'create',v_event,v_description,v_hash,v_context,v_after,v_response);
  perform public._log_entity_audit(v_tenant,'operational_event',v_event,'create',null,
    jsonb_build_object('event',v_after->'event','request_id',v_request,'command_id',v_command),'create_operational_event_v1');
  return v_response;
exception when lock_not_available or deadlock_detected then raise exception 'operational_event_concurrent_change' using errcode='40001';
end;
$fn$;

create function public.resolve_operational_event_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_request uuid;v_event uuid;v_command uuid:=gen_random_uuid();v_resolution text;
 v_expected text;v_hash text;v_before jsonb;v_after jsonb;v_response jsonb;v_existing public.operational_event_commands%rowtype;e public.operational_events%rowtype;
begin
  if _payload is null or jsonb_typeof(_payload)<>'object' or octet_length(_payload::text)>10000
    or _payload->'version' is distinct from '1'::jsonb
    or (_payload-array['version','tenant_id','actor_id','request_id','event_id','expected_revision','resolution'])<>'{}'::jsonb
    or exists(select 1 from jsonb_each(_payload) p where p.key<>'version' and jsonb_typeof(p.value)<>'string') then raise exception 'operational_event_invalid_payload' using errcode='22023';end if;
  v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_event:=(_payload->>'event_id')::uuid;
  v_expected:=_payload->>'expected_revision';v_resolution:=btrim(_payload->>'resolution');
  if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or v_tenant is null or v_request is null or v_event is null
    or v_expected!~'^[0-9a-f]{64}$' or length(v_resolution) not between 5 and 4000 then raise exception 'operational_event_invalid_payload' using errcode='22023';end if;
  perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
  if not found or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'operational_event_not_authorized' using errcode='42501';end if;
  v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtext('operational-event-command'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
  select * into v_existing from public.operational_event_commands where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
  if found then
    if v_existing.action<>'resolve' or v_existing.payload_hash<>v_hash then raise exception 'operational_event_request_key_mismatch' using errcode='22023';end if;
    return v_existing.response;
  end if;
  select * into e from public.operational_events where tenant_id=v_tenant and id=v_event for update nowait;
  if not found then raise exception 'operational_event_not_found' using errcode='23514';end if;
  perform 1 from public.client_occurrence_messages where tenant_id=v_tenant and occurrence_id=v_event order by created_at,id for share nowait;
  perform 1 from public.operational_event_messages where tenant_id=v_tenant and event_id=v_event order by created_at,id for share nowait;
  v_before:=public._operational_event_snapshot(v_tenant,v_event);
  if encode(sha256(convert_to(v_before::text,'UTF8')),'hex')<>v_expected then raise exception 'operational_event_context_changed' using errcode='40001';end if;
  if e.resolved_at is not null then raise exception 'operational_event_already_resolved' using errcode='23514';end if;
  update public.operational_events set resolved_at=clock_timestamp(),resolution=v_resolution,public_status='resolved',
    client_action_required=false,updated_at=clock_timestamp() where tenant_id=v_tenant and id=v_event;
  v_after:=public._operational_event_snapshot(v_tenant,v_event);
  v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'command_id',v_command,
    'event_id',v_event,'action','resolve','confirmed',true,'public_status','resolved','client_action_required',false,
    'resolved_at',v_after#>>'{event,resolved_at}','revision',encode(sha256(convert_to(v_after::text,'UTF8')),'hex'));
  insert into public.operational_event_commands(id,tenant_id,actor_id,request_id,action,event_id,reason,payload_hash,before_snapshot,after_snapshot,response)
    values(v_command,v_tenant,v_actor,v_request,'resolve',v_event,v_resolution,v_hash,v_before,v_after,v_response);
  perform public._log_entity_audit(v_tenant,'operational_event',v_event,'resolve',v_before->'event',
    (v_after->'event')||jsonb_build_object('request_id',v_request,'command_id',v_command),'resolve_operational_event_v1');
  return v_response;
exception when lock_not_available or deadlock_detected then raise exception 'operational_event_concurrent_change' using errcode='40001';
end;
$fn$;

revoke all on function public.get_operational_event_create_context(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_operational_event_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_operator_pod_history_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_operational_event_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.resolve_operational_event_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_operational_event_create_context(uuid,jsonb) to authenticated;
grant execute on function public.get_operational_event_context(uuid,uuid) to authenticated;
grant execute on function public.get_operator_pod_history_v1(uuid,uuid) to authenticated;
grant execute on function public.create_operational_event_v1(jsonb) to authenticated;
grant execute on function public.resolve_operational_event_v1(jsonb) to authenticated;

comment on function public.get_operator_pod_history_v1(uuid,uuid) is
  'Operator-only canonical POD history. Delivery is derived from the active delivery outcome, never from stop arrival.';
comment on function public.create_operational_event_v1(jsonb) is
  'Recoverable tenant-scoped operational-event creation with binding revision, exact replay and audit snapshots.';
comment on function public.resolve_operational_event_v1(jsonb) is
  'Recoverable operational-event resolution that atomically closes the public lifecycle and client action.';
