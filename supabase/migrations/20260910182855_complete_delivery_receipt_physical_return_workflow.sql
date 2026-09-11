-- Auditable custody workflow for the physical paper receipt returned by a driver.
-- Missing paper creates an operational occurrence. Waiving the paper is an
-- explicit owner/admin exception and never changes the digital receipt status.

create table public.delivery_receipt_physical_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null references public.delivery_receipts(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  dispatch_stop_id uuid not null references public.dispatch_stops(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null,
  previous_status text not null check (previous_status in ('pending_return','received','missing','waived')),
  resulting_status text not null check (resulting_status in ('received','missing','waived')),
  reason text,
  occurrence_event_id uuid references public.operational_events(id) on delete restrict,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, request_id),
  constraint delivery_receipt_physical_event_reason_check check (
    (resulting_status = 'received' and reason is null)
    or (resulting_status in ('missing','waived') and length(btrim(reason)) between 5 and 1000)
  )
);

create index delivery_receipt_physical_events_receipt_idx
  on public.delivery_receipt_physical_events(tenant_id, receipt_id, created_at desc);
create index delivery_receipt_physical_events_trip_idx
  on public.delivery_receipt_physical_events(tenant_id, dispatch_trip_id, created_at desc);

alter table public.delivery_receipt_physical_events enable row level security;
revoke all on table public.delivery_receipt_physical_events from public, anon, authenticated, service_role;
grant select on table public.delivery_receipt_physical_events to authenticated;
grant all on table public.delivery_receipt_physical_events to service_role;

create policy delivery_receipt_physical_events_operator_read
  on public.delivery_receipt_physical_events for select to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

create or replace function public.record_delivery_receipt_physical_status_v1(
  _tenant_id uuid,
  _receipt_id uuid,
  _request_id uuid,
  _status text,
  _reason text default null,
  _expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_receipt public.delivery_receipts%rowtype;
  v_existing public.delivery_receipt_physical_events%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_reason text := nullif(btrim(_reason), '');
  v_occurrence_id uuid;
  v_client_id uuid;
  v_load_id uuid;
begin
  if v_actor is null or _tenant_id is null or _receipt_id is null or _request_id is null
    or _status not in ('received','missing','waived')
    or (_status = 'received' and v_reason is not null)
    or (_status in ('missing','waived') and coalesce(length(v_reason), 0) not between 5 and 1000) then
    raise exception 'delivery_receipt_invalid_physical_status' using errcode = '22023';
  end if;
  if not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_not_authorized' using errcode = '42501';
  end if;
  if _status = 'waived' and not coalesce(public.is_tenant_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_physical_waiver_admin_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('delivery-receipt-physical-status'),
    hashtext(_tenant_id::text || ':' || _request_id::text)
  );
  select * into v_existing
  from public.delivery_receipt_physical_events
  where tenant_id = _tenant_id and request_id = _request_id;
  if found then
    if v_existing.receipt_id is distinct from _receipt_id
      or v_existing.resulting_status is distinct from _status
      or v_existing.reason is distinct from v_reason
      or v_existing.actor_id is distinct from v_actor then
      raise exception 'delivery_receipt_physical_request_mismatch' using errcode = '22023';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  select * into v_receipt
  from public.delivery_receipts
  where tenant_id = _tenant_id and id = _receipt_id and is_active
  for update nowait;
  if not found then
    raise exception 'delivery_receipt_not_found' using errcode = 'P0002';
  end if;
  if _expected_updated_at is not null and v_receipt.updated_at is distinct from _expected_updated_at then
    raise exception 'delivery_receipt_changed' using errcode = '40001';
  end if;
  if v_receipt.physical_status = _status then
    raise exception 'delivery_receipt_physical_status_unchanged' using errcode = '23514';
  end if;
  if v_receipt.physical_status = 'received' and _status in ('missing','waived') then
    raise exception 'delivery_receipt_physical_status_regression' using errcode = '23514';
  end if;
  if v_receipt.physical_status = 'waived' and _status = 'missing' then
    raise exception 'delivery_receipt_physical_status_regression' using errcode = '23514';
  end if;

  v_before := to_jsonb(v_receipt);
  update public.delivery_receipts set
    physical_status = _status,
    physical_received_at = case when _status = 'received' then clock_timestamp() else null end,
    physical_received_by = case when _status = 'received' then v_actor else null end,
    updated_at = clock_timestamp()
  where tenant_id = _tenant_id and id = _receipt_id
  returning * into v_receipt;

  if _status = 'missing' then
    select stop.client_id into v_client_id
    from public.dispatch_stops stop
    where stop.tenant_id = _tenant_id and stop.id = v_receipt.dispatch_stop_id;

    select case when count(distinct document.load_id) = 1 then min(document.load_id::text)::uuid else null end
      into v_load_id
    from public.dispatch_stop_documents document
    where document.tenant_id = _tenant_id
      and document.dispatch_stop_id = v_receipt.dispatch_stop_id
      and document.load_id is not null;

    insert into public.operational_events(
      tenant_id, client_id, load_id, vehicle_id, driver_id,
      dispatch_trip_id, dispatch_stop_id, event_type, severity, description,
      visible_to_client, client_action_required, public_status, payload,
      idempotency_key, created_by
    ) values (
      _tenant_id, v_client_id, v_load_id, v_receipt.vehicle_id, v_receipt.driver_id,
      v_receipt.dispatch_trip_id, v_receipt.dispatch_stop_id,
      'delivery_receipt_physical_missing', 'medium', v_reason,
      false, false, 'reported_by_operator',
      jsonb_build_object('source','delivery_receipt_physical_workflow','receipt_id',v_receipt.id,'request_id',_request_id),
      'delivery_receipt_physical:' || _request_id::text, v_actor
    ) returning id into v_occurrence_id;
  end if;

  v_response := jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'request_id', _request_id,
    'id', v_receipt.id,
    'physical_status', v_receipt.physical_status,
    'occurrence_event_id', v_occurrence_id,
    'updated_at', v_receipt.updated_at,
    'confirmed', true,
    'replayed', false
  );
  insert into public.delivery_receipt_physical_events(
    tenant_id, receipt_id, dispatch_trip_id, dispatch_stop_id, request_id,
    actor_id, previous_status, resulting_status, reason, occurrence_event_id, response
  ) values (
    _tenant_id, v_receipt.id, v_receipt.dispatch_trip_id, v_receipt.dispatch_stop_id, _request_id,
    v_actor, v_before->>'physical_status', _status, v_reason, v_occurrence_id, v_response
  );
  perform public._log_entity_audit(
    _tenant_id, 'delivery_receipt', v_receipt.id, 'physical_' || _status,
    v_before, to_jsonb(v_receipt) || jsonb_build_object('reason',v_reason,'request_id',_request_id,'occurrence_event_id',v_occurrence_id),
    'record_delivery_receipt_physical_status_v1'
  );
  return v_response;
exception
  when lock_not_available or deadlock_detected then
    raise exception 'delivery_receipt_changed' using errcode = '40001';
end;
$function$;

revoke all on function public.record_delivery_receipt_physical_status_v1(uuid,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_delivery_receipt_physical_status_v1(uuid,uuid,uuid,text,text,timestamptz)
  to authenticated;

comment on table public.delivery_receipt_physical_events is
  'Immutable audit of physical paper receipt custody, including missing-paper occurrences and admin waivers.';
comment on function public.record_delivery_receipt_physical_status_v1(uuid,uuid,uuid,text,text,timestamptz) is
  'Records received, missing or owner/admin-waived physical receipt states with idempotency and optimistic concurrency.';
