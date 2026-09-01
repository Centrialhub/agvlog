-- Evidence-backed repair for the historical load/trip mismatch authorized for
-- production QA. Keep the trip planned and do not invent actual_start_at.

set local lock_timeout='3s';
set local statement_timeout='20s';

do $repair$
declare
  v_load public.loads%rowtype;
  v_trip public.dispatch_trips%rowtype;
begin
  -- Other environments do not necessarily contain this production QA row.
  -- Absence of both exact IDs is a clean no-op; a partial match is drift.
  if not exists(
    select 1 from public.dispatch_trips
    where id='40f6a9c2-1235-4f3c-b1be-2f2e9f62b814'::uuid
  ) and not exists(
    select 1 from public.loads
    where id='03581475-1745-48f3-a84b-5249539d63e0'::uuid
  ) then
    return;
  end if;

  select * into v_trip
  from public.dispatch_trips
  where id='40f6a9c2-1235-4f3c-b1be-2f2e9f62b814'::uuid
    and tenant_id='6e874e6e-5bca-486d-9928-bef0646989c4'::uuid
  for update;
  if not found then raise exception 'load_1003_trip_precondition_missing'; end if;

  perform 1
  from public.dispatch_trip_loads
  where dispatch_trip_id=v_trip.id and tenant_id=v_trip.tenant_id
  order by id
  for update;

  select * into v_load
  from public.loads
  where id='03581475-1745-48f3-a84b-5249539d63e0'::uuid
    and tenant_id=v_trip.tenant_id
  for update;
  if not found then raise exception 'load_1003_precondition_missing'; end if;

  if v_load.load_number is distinct from '1003'
    or v_load.status is distinct from 'in_transit'
    or v_load.trip_id is distinct from v_trip.id
    or v_load.driver_id is distinct from 'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28'::uuid
    or v_load.vehicle_id is distinct from '6a4ddd12-814b-4ded-82c7-5b16d5a4b456'::uuid
    or v_load.on_hold
    or v_load.updated_at is distinct from '2026-08-18T18:48:18.273+00:00'::timestamptz then
    raise exception 'load_1003_precondition_changed';
  end if;

  if v_trip.status is distinct from 'planned'
    or v_trip.actual_start_at is not null
    or v_trip.actual_end_at is not null
    or v_trip.driver_id is distinct from v_load.driver_id
    or v_trip.vehicle_id is distinct from v_load.vehicle_id
    or v_trip.updated_at is distinct from '2026-08-25T16:10:10.286572+00:00'::timestamptz then
    raise exception 'load_1003_trip_precondition_changed';
  end if;

  if exists(
    select 1 from public.dispatch_stops s
    where s.dispatch_trip_id=v_trip.id and s.tenant_id=v_trip.tenant_id
      and (s.status not in('pending','planned') or s.actual_arrival_at is not null or s.actual_departure_at is not null)
  ) or exists(
    select 1 from public.dispatch_events e
    where e.dispatch_trip_id=v_trip.id and e.tenant_id=v_trip.tenant_id
  ) or exists(
    select 1 from public.proof_of_delivery p
    where p.load_id=v_load.id and p.tenant_id=v_load.tenant_id
  ) or exists(
    select 1 from public.operational_events o
    where o.load_id=v_load.id and o.tenant_id=v_load.tenant_id
  ) or exists(
    select 1 from public.fiscal_documents f
    where f.load_id=v_load.id and f.tenant_id=v_load.tenant_id
      and f.status is distinct from 'deleted'
  ) then
    raise exception 'load_1003_operational_evidence_changed';
  end if;

  insert into public.entity_audit_log(
    tenant_id,entity_type,entity_id,action,old_data,new_data,
    actor_user_id,actor_role,source,request_id
  ) values (
    v_load.tenant_id,'load',v_load.id,'reconcile_trip_load_start_invariant',
    jsonb_build_object(
      'status',v_load.status,'trip_id',v_load.trip_id,
      'load_updated_at',v_load.updated_at,'trip_status',v_trip.status,
      'trip_actual_start_at',v_trip.actual_start_at,
      'evidence',jsonb_build_object(
        'trip_event_count',0,'proof_count',0,'operational_event_count',0,
        'stop_states','pending_or_planned','document_states','deleted'
      )
    ),
    jsonb_build_object(
      'status','ready','trip_id',v_load.trip_id,'trip_status',v_trip.status,
      'trip_actual_start_at',v_trip.actual_start_at,
      'reason','No departure evidence; preserve planned trip without inventing actual_start_at'
    ),
    null,'platform_migration',
    'authorized_reconciliation:load_1003_no_start_evidence',
    '20260831-load-1003-trip-start-invariant'
  );

  update public.loads
  set status='ready',updated_at=clock_timestamp()
  where id=v_load.id and tenant_id=v_load.tenant_id;
end;
$repair$;
