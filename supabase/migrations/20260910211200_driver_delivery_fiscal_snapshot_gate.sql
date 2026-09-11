-- The driver may prepare a delivery while offline, but the fiscal allocation
-- used by the eventual writer must still be exactly the allocation captured on
-- the device. NF-e and NFS-e are peers; CT-e is intentionally not a prerequisite.

create table public.driver_delivery_fiscal_conflicts(
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  dispatch_stop_id uuid not null references public.dispatch_stops(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_hash text not null check(request_hash~'^[0-9a-f]{32}$'),
  expected_revision text,
  actual_revision text not null check(actual_revision~'^[0-9a-f]{32}$'),
  expected_snapshot jsonb,
  actual_snapshot jsonb not null,
  delivery_payload jsonb not null,
  status text not null default 'pending' check(status in('pending','resolved')),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_reason text,
  check((status='pending' and resolved_at is null and resolved_by is null and resolution_reason is null)
    or (status='resolved' and resolved_at is not null and resolved_by is not null
      and length(btrim(resolution_reason)) between 5 and 1000))
);
create index driver_delivery_fiscal_conflicts_queue_idx
  on public.driver_delivery_fiscal_conflicts(tenant_id,status,created_at,request_id);
alter table public.driver_delivery_fiscal_conflicts enable row level security;
revoke all on table public.driver_delivery_fiscal_conflicts from public,anon,authenticated,service_role;
grant all on table public.driver_delivery_fiscal_conflicts to service_role;

create or replace function delivery_private.delivery_fiscal_snapshot_payload_v1(
  _tenant_id uuid,_trip_id uuid,_stop_id uuid,_actor_id uuid
) returns jsonb language sql stable security definer set search_path='' as $function$
  with document_rows as (
    select jsonb_build_object(
      'kind','nfe','document_id',document.id,'allocation_id',allocation.id,
      'load_id',coalesce(allocation.load_id,document.load_id),
      'attempt_id',allocation.delivery_attempt_id,'status',document.status
    ) document
    from public.dispatch_stop_documents allocation
    join public.delivery_allocation_documents document on document.allocation_id=allocation.id
    where allocation.tenant_id=_tenant_id and allocation.dispatch_stop_id=_stop_id
    union all
    select jsonb_build_object(
      'kind','nfse','document_id',document.id,'allocation_id',direct_link.nfse_document_id,
      'load_id',coalesce(direct_link.load_id,document.load_id),
      'attempt_id',null,'status',document.status
    ) document
    from public.dispatch_stop_nfse_documents direct_link
    join public.nfse_documents document on document.id=direct_link.nfse_document_id
      and document.tenant_id=direct_link.tenant_id
    where direct_link.tenant_id=_tenant_id and direct_link.dispatch_stop_id=_stop_id
      and document.status in('issued','authorized')
    union all
    select jsonb_build_object(
      'kind','nfse','document_id',document.id,'allocation_id',null,
      'load_id',document.load_id,'attempt_id',null,'status',document.status
    ) document
    from public.nfse_documents document
    where document.tenant_id=_tenant_id and document.status in('issued','authorized')
      and not coalesce(document.cancelled,false) and not coalesce(document.is_preview,false)
      and not exists(select 1 from public.dispatch_stop_nfse_documents direct_link
        where direct_link.tenant_id=_tenant_id and direct_link.nfse_document_id=document.id)
      and 1=(select count(*) from public.dispatch_stops stop
        where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id)
      and (document.trip_id=_trip_id or document.load_id in(select trip_load.load_id
        from public.dispatch_trip_loads trip_load where trip_load.tenant_id=_tenant_id
          and trip_load.dispatch_trip_id=_trip_id))
  ), canonical as (
    select coalesce(jsonb_agg(document order by document->>'kind',document->>'document_id',
      coalesce(document->>'allocation_id','')),'[]'::jsonb) documents from document_rows
  ), content as (
    select jsonb_build_object('version',1,'tenant_id',_tenant_id,'trip_id',_trip_id,
      'stop_id',_stop_id,'documents',documents) value from canonical
  )
  select value||jsonb_build_object('actor_id',_actor_id,'captured_at',clock_timestamp(),
    'revision',md5(value::text)) from content
$function$;
revoke all on function delivery_private.delivery_fiscal_snapshot_payload_v1(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_driver_delivery_fiscal_snapshot_v1(
  _tenant_id uuid,_trip_id uuid,_stop_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_stop public.dispatch_stops%rowtype;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id then
    raise exception 'delivery_fiscal_snapshot_not_authorized' using errcode='42501';end if;
  select * into v_stop from public.dispatch_stops where id=_stop_id and tenant_id=_tenant_id
    and dispatch_trip_id=_trip_id;
  if not found then raise exception 'delivery_fiscal_snapshot_stop_not_found' using errcode='P0002';end if;
  perform public._assert_driver_owns_trip(_trip_id);
  return delivery_private.delivery_fiscal_snapshot_payload_v1(_tenant_id,_trip_id,_stop_id,auth.uid());
end;$function$;
revoke all on function public.get_driver_delivery_fiscal_snapshot_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_driver_delivery_fiscal_snapshot_v1(uuid,uuid,uuid) to authenticated;

-- A direct service mutation must serialize on the same stop as the delivery
-- writer. Normal replanning already locks the trip graph in this order.
create or replace function delivery_private.lock_delivery_fiscal_allocation_stop_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_expected integer:=case when tg_op='UPDATE' and old.dispatch_stop_id is distinct from new.dispatch_stop_id then 2 else 1 end;
  v_locked integer;
begin
  -- Reassignment must lock both ends in a deterministic order. Otherwise a
  -- writer holding the old stop could race an UPDATE that locked only the new.
  select count(*) into v_locked from (
    select stop.id from public.dispatch_stops stop
    where stop.id=case when tg_op='INSERT' then new.dispatch_stop_id else old.dispatch_stop_id end
      or (tg_op='UPDATE' and stop.id=new.dispatch_stop_id)
    order by stop.id for update nowait
  ) locked;
  if v_locked<>v_expected then
    raise exception 'delivery_fiscal_allocation_stop_not_found' using errcode='23514';end if;
  return case when tg_op='DELETE' then old else new end;
exception when lock_not_available then
  raise exception 'delivery_fiscal_allocation_concurrent_writer'
    using errcode='40001',hint='Retry after the delivery writer commits.';
end;$function$;
revoke all on function delivery_private.lock_delivery_fiscal_allocation_stop_v1()
  from public,anon,authenticated,service_role;
create trigger lock_delivery_fiscal_allocation_stop_v1
before insert or update of tenant_id,dispatch_stop_id,fiscal_document_id,load_id,delivery_attempt_id
  or delete on public.dispatch_stop_documents
for each row execute function delivery_private.lock_delivery_fiscal_allocation_stop_v1();
create trigger lock_delivery_nfse_allocation_stop_v1
before insert or update of tenant_id,dispatch_stop_id,nfse_document_id,load_id
  or delete on public.dispatch_stop_nfse_documents
for each row execute function delivery_private.lock_delivery_fiscal_allocation_stop_v1();

-- The writer owns the lock order: stop first, then every currently relevant
-- document ordered by kind/id, then snapshot recheck. Fiscal callbacks only
-- lock their document row, so a callback that started first can finish while
-- the writer waits; it never waits back on the stop and cannot form a cycle.
create or replace function delivery_private.lock_delivery_fiscal_documents_v1(
  _tenant_id uuid,_trip_id uuid,_stop_id uuid
) returns void language plpgsql security definer set search_path='' as $function$
begin
  perform document.id
    from public.dispatch_stop_documents allocation
    join public.fiscal_documents document on document.id=allocation.fiscal_document_id
    where allocation.tenant_id=_tenant_id and allocation.dispatch_stop_id=_stop_id
    order by document.id for update of document;
  perform document.id
    from public.nfse_documents document
    where document.tenant_id=_tenant_id and (
      exists(select 1 from public.dispatch_stop_nfse_documents direct_link
        where direct_link.tenant_id=_tenant_id and direct_link.dispatch_stop_id=_stop_id
          and direct_link.nfse_document_id=document.id)
      or (not exists(select 1 from public.dispatch_stop_nfse_documents direct_link
            where direct_link.tenant_id=_tenant_id and direct_link.nfse_document_id=document.id)
        and 1=(select count(*) from public.dispatch_stops stop
          where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id)
        and (document.trip_id=_trip_id or document.load_id in(select trip_load.load_id
          from public.dispatch_trip_loads trip_load where trip_load.tenant_id=_tenant_id
            and trip_load.dispatch_trip_id=_trip_id))))
    order by document.id for update;
end;$function$;
revoke all on function delivery_private.lock_delivery_fiscal_documents_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

alter function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)
  rename to driver_record_delivery_outcome_without_fiscal_gate_v1;
revoke all on function public.driver_record_delivery_outcome_without_fiscal_gate_v1(uuid,text,jsonb,uuid,text)
  from public,anon,authenticated,service_role;

create function public.driver_record_delivery_outcome(
  _stop_id uuid,_outcome text,_details jsonb default '{}'::jsonb,
  _client_event_id uuid default null,_expected_status text default null
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_stop public.dispatch_stops%rowtype;v_existing public.dispatch_events%rowtype;
  v_existing_conflict public.driver_delivery_fiscal_conflicts%rowtype;
  v_expected jsonb;v_actual jsonb;v_request_hash text;v_result jsonb;
begin
  if _client_event_id is null then raise exception 'delivery_request_id_required' using errcode='22023';end if;
  -- One request id has one global decision even if two sessions race or a
  -- buggy client reuses it for different stops.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('driver_delivery:'||_client_event_id::text,0));
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  v_request_hash:=md5(jsonb_build_object('stop_id',_stop_id,'outcome',_outcome,'details',_details,
    'expected_status',_expected_status)::text);

  -- A lost successful response must replay even though the writer itself has
  -- already changed document statuses and therefore the live revision.
  select * into v_existing from public.dispatch_events event
  where event.tenant_id=v_stop.tenant_id and event.created_by=auth.uid()
    and event.payload->>'client_event_id'=_client_event_id::text
    and event.payload?'delivery_result' order by event.event_at desc,event.id desc limit 1;
  if found then
    return public.driver_record_delivery_outcome_without_fiscal_gate_v1(
      _stop_id,_outcome,_details,_client_event_id,_expected_status);end if;

  select * into v_existing_conflict from public.driver_delivery_fiscal_conflicts
    where request_id=_client_event_id for update;
  if found then
    if v_existing_conflict.tenant_id is distinct from v_stop.tenant_id
      or v_existing_conflict.dispatch_stop_id is distinct from _stop_id
      or v_existing_conflict.actor_id is distinct from auth.uid()
      or v_existing_conflict.request_hash is distinct from v_request_hash then
      raise exception 'delivery_request_id_conflict' using errcode='23505';end if;
    return v_existing_conflict.result||jsonb_build_object('replayed',true);
  end if;

  perform delivery_private.lock_delivery_fiscal_documents_v1(
    v_stop.tenant_id,v_stop.dispatch_trip_id,v_stop.id);
  v_expected:=_details->'fiscal_snapshot';
  v_actual:=delivery_private.delivery_fiscal_snapshot_payload_v1(
    v_stop.tenant_id,v_stop.dispatch_trip_id,v_stop.id,auth.uid());
  if jsonb_typeof(v_expected) is distinct from 'object'
    or v_expected->>'version' is distinct from '1'
    or v_expected->>'tenant_id' is distinct from v_stop.tenant_id::text
    or v_expected->>'actor_id' is distinct from auth.uid()::text
    or v_expected->>'trip_id' is distinct from v_stop.dispatch_trip_id::text
    or v_expected->>'stop_id' is distinct from v_stop.id::text
    or coalesce(v_expected->>'revision','')!~'^[0-9a-f]{32}$'
    or v_expected->>'revision' is distinct from v_actual->>'revision' then
    v_result:=jsonb_build_object('version',1,'confirmed',false,'conflict',true,
      'error_code','delivery_fiscal_snapshot_changed','request_id',_client_event_id,
      'stop_id',_stop_id,'trip_id',v_stop.dispatch_trip_id,
      'expected_revision',v_expected->>'revision','actual_revision',v_actual->>'revision','replayed',false);
    insert into public.driver_delivery_fiscal_conflicts(request_id,tenant_id,dispatch_trip_id,
      dispatch_stop_id,actor_id,request_hash,expected_revision,actual_revision,
      expected_snapshot,actual_snapshot,delivery_payload,result)
    values(_client_event_id,v_stop.tenant_id,v_stop.dispatch_trip_id,v_stop.id,auth.uid(),v_request_hash,
      v_expected->>'revision',v_actual->>'revision',v_expected,v_actual,_details,v_result);
    perform public._log_entity_audit(v_stop.tenant_id,'dispatch_stop',v_stop.id,
      'driver_delivery_fiscal_snapshot_conflict',v_expected,v_actual,'driver_app');
    return v_result;
  end if;
  return public.driver_record_delivery_outcome_without_fiscal_gate_v1(
    _stop_id,_outcome,_details,_client_event_id,_expected_status);
end;$function$;
revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) to authenticated;

comment on table public.driver_delivery_fiscal_conflicts is
  'Private-by-grant review queue; drivers and operators use sanitized RPCs and never read proof paths directly.';
comment on function public.get_driver_delivery_fiscal_snapshot_v1(uuid,uuid,uuid) is
  'Returns the exact NF-e/NFS-e allocation precondition required by the delivery writer; CT-e is never required.';
