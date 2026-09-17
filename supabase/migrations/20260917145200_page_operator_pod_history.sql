create or replace function public.get_operator_pod_history_collections_v1(
  _tenant_id uuid,
  _document_id uuid,
  _page integer default 1,
  _page_size integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_document public.fiscal_documents%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'pod_history_not_authorized' using errcode = '42501';
  end if;
  if _page not between 1 and 1000000 or _page_size not between 1 and 50 then
    raise exception 'pod_history_invalid_page' using errcode = '22023';
  end if;
  select * into v_document from public.fiscal_documents
    where tenant_id = _tenant_id and id = _document_id and deleted_at is null;
  if not found then raise exception 'pod_history_document_not_found' using errcode = '23514'; end if;

  return jsonb_build_object(
    'version', 1, 'tenant_id', _tenant_id, 'document_id', _document_id,
    'page', _page, 'page_size', _page_size,
    'totals', jsonb_build_object(
      'attempts', (select count(*) from public.delivery_attempts a where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id),
      'outcomes', (select count(*) from public.delivery_document_outcomes h where h.tenant_id=_tenant_id and h.fiscal_document_id=_document_id),
      'proofs', (select count(*) from public.proof_of_delivery p where p.tenant_id=_tenant_id and p.fiscal_document_id=_document_id),
      'allocations', (select count(*) from public.dispatch_stop_documents a where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id),
      'occurrences', (select count(*) from public.operational_events e where e.tenant_id=_tenant_id and (
        e.fiscal_document_id=_document_id or exists(select 1 from public.proof_of_delivery p
          where p.tenant_id=_tenant_id and p.id=e.proof_of_delivery_id and p.fiscal_document_id=_document_id)))
    ),
    'attempts', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.recorded_at desc,row_value.id desc) from (
      select a.id,a.previous_attempt_id,a.previous_outcome_id,a.source_allocation_id,a.event_id,a.actor_id,a.reason,a.recorded_at,
        a.id=v_document.current_delivery_attempt_id is_current
      from public.delivery_attempts a where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id
      order by a.recorded_at desc,a.id desc limit _page_size offset (_page-1)*_page_size
    ) row_value),'[]'),
    'outcomes', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.recorded_at desc,row_value.id desc) from (
      select h.id,h.delivery_attempt_id attempt_id,h.outcome,h.source,h.load_id,h.dispatch_trip_id trip_id,h.dispatch_stop_id stop_id,
        h.dispatch_stop_document_id allocation_id,h.event_id,h.occurred_at,h.recorded_at,h.reason,
        h.id=(select current_row.id from public.active_delivery_document_outcomes current_row
          where current_row.tenant_id=_tenant_id and current_row.fiscal_document_id=_document_id
            and current_row.delivery_attempt_id is not distinct from v_document.current_delivery_attempt_id
          order by current_row.recorded_at desc,current_row.id desc limit 1) is_current,
        correction.corrected_outcome_id superseded_by
      from public.delivery_document_outcomes h
      left join public.delivery_document_corrections correction on correction.previous_outcome_id=h.id
      where h.tenant_id=_tenant_id and h.fiscal_document_id=_document_id
      order by h.recorded_at desc,h.id desc limit _page_size offset (_page-1)*_page_size
    ) row_value),'[]'),
    'proofs', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.version desc,row_value.id desc) from (
      select p.id,p.version,p.status,p.proof_type,p.load_id,p.dispatch_trip_id trip_id,p.dispatch_stop_id stop_id,p.is_active,
        p.retired_event_id,p.retired_at,p.storage_bucket,p.storage_path,p.photo_url,p.signature_url,p.receiver_name,
        p.receiver_document,p.received_at,p.created_at,p.updated_at
      from public.proof_of_delivery p where p.tenant_id=_tenant_id and p.fiscal_document_id=_document_id
      order by p.version desc,p.id desc limit _page_size offset (_page-1)*_page_size
    ) row_value),'[]'),
    'allocations', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.actual_start_at desc nulls last,row_value.id desc) from (
      select a.id,a.delivery_attempt_id attempt_id,a.load_id,s.id stop_id,s.status stop_status,s.destination,
        s.actual_arrival_at,s.actual_departure_at,t.id trip_id,t.status trip_status,t.actual_start_at,
        a.id=(select current_a.id from public.dispatch_stop_documents current_a
          where current_a.tenant_id=_tenant_id and current_a.fiscal_document_id=_document_id
            and current_a.delivery_attempt_id is not distinct from v_document.current_delivery_attempt_id
          order by current_a.created_at desc nulls last,current_a.id desc limit 1) is_current
      from public.dispatch_stop_documents a
      join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id
      join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
      where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id
      order by t.actual_start_at desc nulls last,a.id desc limit _page_size offset (_page-1)*_page_size
    ) row_value),'[]'),
    'occurrences', coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc,row_value.id desc) from (
      select e.id,e.event_type,e.severity,e.description,e.visible_to_client,e.client_action_required,e.public_status,
        e.resolved_at,e.created_at,e.updated_at
      from public.operational_events e where e.tenant_id=_tenant_id and (
        e.fiscal_document_id=_document_id or exists(select 1 from public.proof_of_delivery p
          where p.tenant_id=_tenant_id and p.id=e.proof_of_delivery_id and p.fiscal_document_id=_document_id))
      order by e.created_at desc,e.id desc limit _page_size offset (_page-1)*_page_size
    ) row_value),'[]')
  );
end;
$function$;

revoke all on function public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer)
  to authenticated;

create or replace function public.get_operator_pod_history_v1(_tenant_id uuid,_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare f public.fiscal_documents%rowtype;v_current public.delivery_document_outcomes%rowtype;v_current_allocation uuid;v_result jsonb;v_collections jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'pod_history_not_authorized' using errcode='42501';end if;
  select * into f from public.fiscal_documents where tenant_id=_tenant_id and id=_document_id and deleted_at is null;
  if not found then raise exception 'pod_history_document_not_found' using errcode='23514';end if;
  select * into v_current from public.active_delivery_document_outcomes h
    where h.tenant_id=_tenant_id and h.fiscal_document_id=f.id
      and h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id
    order by h.recorded_at desc,h.id desc limit 1;
  select a.id into v_current_allocation from public.dispatch_stop_documents a
    where a.tenant_id=_tenant_id and a.fiscal_document_id=f.id
      and a.delivery_attempt_id is not distinct from f.current_delivery_attempt_id
    order by a.created_at desc nulls last,a.id desc limit 1;
  v_collections:=public.get_operator_pod_history_collections_v1(_tenant_id,_document_id,1,25);
  v_result:=jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'document_id',f.id,
    'document',jsonb_build_object('id',f.id,'document_type',f.document_type,'invoice_number',f.invoice_number,
      'status',f.status,'load_id',f.load_id,'client_id',f.client_id,'current_delivery_attempt_id',f.current_delivery_attempt_id,'updated_at',f.updated_at),
    'canonical_state',case when v_current.id is not null then v_current.outcome when f.current_delivery_attempt_id is not null then 'pending_redelivery' else 'pending' end,
    'delivered',coalesce(v_current.outcome='delivered',false),
    'proof_available',exists(select 1 from public.available_delivery_proofs p where p.tenant_id=_tenant_id and p.fiscal_document_id=f.id),
    'arrival_without_outcome',v_current.id is null and exists(select 1 from public.dispatch_stop_documents a join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id where a.tenant_id=_tenant_id and a.id=v_current_allocation and s.actual_arrival_at is not null),
    'current_outcome',case when v_current.id is null then null else jsonb_build_object('id',v_current.id,'attempt_id',v_current.delivery_attempt_id,'outcome',v_current.outcome,'source',v_current.source,'load_id',v_current.load_id,'trip_id',v_current.dispatch_trip_id,'stop_id',v_current.dispatch_stop_id,'occurred_at',v_current.occurred_at,'recorded_at',v_current.recorded_at,'reason',v_current.reason) end,
    'current_allocation',(select jsonb_build_object('id',a.id,'attempt_id',a.delivery_attempt_id,'load_id',a.load_id,'stop_id',s.id,'stop_status',s.status,'destination',s.destination,'actual_arrival_at',s.actual_arrival_at,'actual_departure_at',s.actual_departure_at,'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,'is_current',true) from public.dispatch_stop_documents a join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id where a.tenant_id=_tenant_id and a.id=v_current_allocation)
  ) || (v_collections - 'version' - 'tenant_id' - 'document_id');
  return v_result||jsonb_build_object('actor_id',auth.uid(),'revision',encode(sha256(convert_to(v_result::text,'UTF8')),'hex'));
end;
$function$;

revoke all on function public.get_operator_pod_history_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operator_pod_history_v1(uuid,uuid) to authenticated;
