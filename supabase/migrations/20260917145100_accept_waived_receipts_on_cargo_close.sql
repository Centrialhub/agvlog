create or replace function private.close_trip_cargo(_tenant_id uuid,_trip_id uuid,_override_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;v_role text;v_pending bigint;v_missing bigint;v_override boolean;
begin
  v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,true);
  select membership.role into v_role from public.tenant_memberships membership where membership.tenant_id=_tenant_id
    and membership.user_id=auth.uid() and membership.active;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id for update;
  if not found or v_control.status not in('returned','closed') then raise exception 'trip_cargo_return_required' using errcode='23514';end if;
  if v_control.status='closed' then return jsonb_build_object('version',1,'confirmed',true,'trip_id',_trip_id,'control_id',v_control.id,'status','closed','changed',false);end if;
  if exists(select 1 from public.trip_cargo_divergences where control_id=v_control.id and status in('pending','rejected')) then
    raise exception 'trip_cargo_divergences_pending' using errcode='23514';end if;
  if exists(
    select 1 from public.trip_cargo_seals seal_row where seal_row.control_id=v_control.id and (
      seal_row.status not in('removed','broken','missing') or seal_row.resolved_at is null or seal_row.resolved_by is null
      or length(btrim(coalesce(seal_row.resolution_reason,'')))<5
      or (seal_row.resolution_evidence_id is null and not seal_row.evidence_waived_legacy)
    )
  ) then raise exception 'trip_cargo_seals_unresolved' using errcode='23514';end if;
  select count(*) into v_pending from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id
    and receipt.dispatch_trip_id=_trip_id and receipt.is_active and receipt.physical_status not in('received','waived');
  select count(*) into v_missing from public.dispatch_stops stop where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id
    and stop.status in('delivered','partial_delivery') and not exists(select 1 from public.delivery_receipts receipt
      where receipt.tenant_id=_tenant_id and receipt.dispatch_stop_id=stop.id and receipt.is_active);
  v_override:=v_pending+v_missing>0;
  if v_override and (v_role not in('owner','admin') or length(btrim(coalesce(_override_reason,'')))<10) then
    raise exception 'trip_cargo_physical_receipts_pending' using errcode='23514',detail=jsonb_build_object('pending',v_pending,'missing',v_missing)::text;
  end if;
  update public.trip_cargo_controls set status='closed',closed_at=clock_timestamp(),closed_by=auth.uid(),
    close_override_reason=case when v_override then btrim(_override_reason) else null end,updated_at=clock_timestamp()
    where id=v_control.id returning * into v_control;
  perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,
    case when v_override then 'supervisor_close_override' else 'close_after_physical_reconciliation' end,
    null,jsonb_build_object('pending_receipts',v_pending,'missing_receipts',v_missing,'reason',v_control.close_override_reason),'operational');
  return jsonb_build_object('version',1,'confirmed',true,'trip_id',_trip_id,'control_id',v_control.id,'status','closed',
    'changed',true,'override',v_override,'pending_receipts',v_pending,'missing_receipts',v_missing,'updated_at',v_control.updated_at);
end;$function$;
