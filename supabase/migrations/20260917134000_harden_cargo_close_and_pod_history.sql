-- Close custody only after every seal has a complete terminal record, and make
-- the POD reader attribute arrival, allocation and occurrences to this NF only.

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
    and receipt.dispatch_trip_id=_trip_id and receipt.is_active and receipt.physical_status<>'received';
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

create or replace function public.get_operator_pod_history_v1(_tenant_id uuid,_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare f public.fiscal_documents%rowtype;v_current public.delivery_document_outcomes%rowtype;v_current_allocation uuid;v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'pod_history_not_authorized' using errcode='42501';end if;
  select * into f from public.fiscal_documents where tenant_id=_tenant_id and id=_document_id and deleted_at is null;
  if not found then raise exception 'pod_history_document_not_found' using errcode='23514';end if;
  select * into v_current from public.active_delivery_document_outcomes h
    where h.tenant_id=_tenant_id and h.fiscal_document_id=f.id
      and h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id
    order by h.recorded_at desc,h.id desc limit 1;
  select a.id into v_current_allocation
    from public.dispatch_stop_documents a
    where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id
      and a.delivery_attempt_id is not distinct from f.current_delivery_attempt_id
    order by a.created_at desc nulls last,a.id desc limit 1;

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
      where a.tenant_id=_tenant_id and a.id=v_current_allocation and s.actual_arrival_at is not null),
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
      'is_current',a.id=v_current_allocation) order by t.actual_start_at nulls first,s.id,a.id)
      from public.dispatch_stop_documents a join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id
      join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
      where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id),'[]'),
    'occurrences',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'severity',e.severity,
      'description',e.description,'visible_to_client',e.visible_to_client,'client_action_required',e.client_action_required,
      'public_status',e.public_status,'resolved_at',e.resolved_at,'created_at',e.created_at,'updated_at',e.updated_at)
      order by e.created_at,e.id) from public.operational_events e where e.tenant_id=_tenant_id and (
        e.fiscal_document_id=f.id or exists(select 1 from public.proof_of_delivery p
          where p.tenant_id=_tenant_id and p.id=e.proof_of_delivery_id and p.fiscal_document_id=f.id)
      )),'[]')
  );
  return v_result||jsonb_build_object('actor_id',auth.uid(),'revision',encode(sha256(convert_to(v_result::text,'UTF8')),'hex'));
end;
$function$;

revoke all on function public.get_operator_pod_history_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operator_pod_history_v1(uuid,uuid) to authenticated;

comment on function public.get_operator_pod_history_v1(uuid,uuid) is
  'Operator-only canonical POD history with one deterministic current allocation and document-scoped occurrences.';
