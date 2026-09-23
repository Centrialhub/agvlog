create or replace function public.get_operator_pod_history_collections_v1(
  _tenant_id uuid,
  _document_id uuid,
  _page integer default 1,
  _page_size integer default 25,
  _snapshot_at timestamptz default null,
  _expected_revision text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_document public.fiscal_documents%rowtype;
  v_current_outcome_id uuid;
  v_current_allocation_id uuid;
  v_snapshot_at timestamptz:=coalesce(_snapshot_at,clock_timestamp());
  v_revision text;
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'pod_history_not_authorized' using errcode = '42501';
  end if;
  if _page not between 1 and 1000000 or _page_size not between 1 and 50 then
    raise exception 'pod_history_invalid_page' using errcode = '22023';
  end if;
  select * into v_document from public.fiscal_documents
  where tenant_id=_tenant_id and id=_document_id and deleted_at is null;
  if not found then raise exception 'pod_history_document_not_found' using errcode='23514'; end if;

  select current_row.id into v_current_outcome_id
  from public.active_delivery_document_outcomes current_row
  where current_row.tenant_id=_tenant_id and current_row.fiscal_document_id=_document_id
    and current_row.delivery_attempt_id is not distinct from v_document.current_delivery_attempt_id
  order by current_row.recorded_at desc,current_row.id desc limit 1;
  select current_row.id into v_current_allocation_id
  from public.dispatch_stop_documents current_row
  where current_row.tenant_id=_tenant_id and current_row.fiscal_document_id=_document_id
    and current_row.delivery_attempt_id is not distinct from v_document.current_delivery_attempt_id
  order by current_row.created_at desc nulls last,current_row.id desc limit 1;

  with all_rows as materialized (
    select 'attempts'::text kind,a.recorded_at event_at,a.id,
      jsonb_build_object('id',a.id,'previous_attempt_id',a.previous_attempt_id,'previous_outcome_id',a.previous_outcome_id,
        'source_allocation_id',a.source_allocation_id,'event_id',a.event_id,'actor_id',a.actor_id,'reason',a.reason,
        'recorded_at',a.recorded_at,'is_current',a.id=v_document.current_delivery_attempt_id) payload
    from public.delivery_attempts a where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id
      and a.recorded_at<=v_snapshot_at
    union all
    select 'outcomes',h.occurred_at,h.id,
      jsonb_build_object('id',h.id,'attempt_id',h.delivery_attempt_id,'outcome',h.outcome,'source',h.source,'load_id',h.load_id,
        'trip_id',h.dispatch_trip_id,'stop_id',h.dispatch_stop_id,'allocation_id',h.dispatch_stop_document_id,'event_id',h.event_id,
        'occurred_at',h.occurred_at,'recorded_at',h.recorded_at,'reason',h.reason,'is_current',h.id=v_current_outcome_id,
        'superseded_by',correction.corrected_outcome_id)
    from public.delivery_document_outcomes h
    left join public.delivery_document_corrections correction on correction.previous_outcome_id=h.id
    where h.tenant_id=_tenant_id and h.fiscal_document_id=_document_id and h.recorded_at<=v_snapshot_at
    union all
    select 'proofs',coalesce(p.received_at,p.created_at,p.updated_at,'epoch'::timestamptz),p.id,
      jsonb_build_object('id',p.id,'version',p.version,'status',p.status,'proof_type',p.proof_type,'load_id',p.load_id,
        'trip_id',p.dispatch_trip_id,'stop_id',p.dispatch_stop_id,'is_active',p.is_active,'retired_event_id',p.retired_event_id,
        'retired_at',p.retired_at,'storage_bucket',p.storage_bucket,'storage_path',p.storage_path,'photo_url',p.photo_url,
        'signature_url',p.signature_url,'receiver_name',p.receiver_name,'receiver_document',p.receiver_document,
        'received_at',p.received_at,'created_at',p.created_at,'updated_at',p.updated_at)
    from public.proof_of_delivery p where p.tenant_id=_tenant_id and p.fiscal_document_id=_document_id
      and coalesce(p.created_at,p.updated_at,'epoch'::timestamptz)<=v_snapshot_at
    union all
    select 'allocations',greatest(t.actual_start_at,s.actual_arrival_at,s.actual_departure_at,a.created_at),a.id,
      jsonb_build_object('id',a.id,'attempt_id',a.delivery_attempt_id,'load_id',a.load_id,'stop_id',s.id,'stop_status',s.status,
        'destination',s.destination,'actual_arrival_at',s.actual_arrival_at,'actual_departure_at',s.actual_departure_at,
        'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,'is_current',a.id=v_current_allocation_id)
    from public.dispatch_stop_documents a
    join public.dispatch_stops s on s.tenant_id=a.tenant_id and s.id=a.dispatch_stop_id
    join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
    where a.tenant_id=_tenant_id and a.fiscal_document_id=_document_id and a.created_at<=v_snapshot_at
    union all
    select 'occurrences',greatest(e.created_at,e.resolved_at),e.id,
      jsonb_build_object('id',e.id,'event_type',e.event_type,'severity',e.severity,'description',e.description,
        'visible_to_client',e.visible_to_client,'client_action_required',e.client_action_required,'public_status',e.public_status,
        'resolved_at',e.resolved_at,'created_at',e.created_at,'updated_at',e.updated_at)
    from public.operational_events e where e.tenant_id=_tenant_id and e.created_at<=v_snapshot_at and (
      e.fiscal_document_id=_document_id or exists(select 1 from public.proof_of_delivery p
        where p.tenant_id=_tenant_id and p.id=e.proof_of_delivery_id and p.fiscal_document_id=_document_id))
  ), page_rows as materialized (
    select * from all_rows order by event_at desc,id desc limit _page_size offset (_page-1)*_page_size
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'document_id',_document_id,'page',_page,'page_size',_page_size,
    'snapshot_at',v_snapshot_at,
    'collection_revision',encode(sha256(convert_to(coalesce((select jsonb_agg(
      jsonb_build_array(kind,id,event_at,payload) order by kind,id)::text from all_rows),'[]'),'UTF8')),'hex'),
    'totals',jsonb_build_object(
      'attempts',(select count(*) from all_rows where kind='attempts'),
      'outcomes',(select count(*) from all_rows where kind='outcomes'),
      'proofs',(select count(*) from all_rows where kind='proofs'),
      'allocations',(select count(*) from all_rows where kind='allocations'),
      'occurrences',(select count(*) from all_rows where kind='occurrences')),
    'attempts',coalesce((select jsonb_agg(payload order by event_at desc,id desc) from page_rows where kind='attempts'),'[]'::jsonb),
    'outcomes',coalesce((select jsonb_agg(payload order by event_at desc,id desc) from page_rows where kind='outcomes'),'[]'::jsonb),
    'proofs',coalesce((select jsonb_agg(payload order by event_at desc,id desc) from page_rows where kind='proofs'),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(payload order by event_at desc,id desc) from page_rows where kind='allocations'),'[]'::jsonb),
    'occurrences',coalesce((select jsonb_agg(payload order by event_at desc,id desc) from page_rows where kind='occurrences'),'[]'::jsonb)
  ) into v_result;
  v_revision:=v_result->>'collection_revision';
  if _snapshot_at is not null and _snapshot_at<>v_snapshot_at then
    raise exception 'pod_history_snapshot_mismatch' using errcode='22023';
  end if;
  if _expected_revision is not null and _expected_revision<>v_revision then
    raise exception 'pod_history_changed' using errcode='40001';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer,timestamptz,text)
  to authenticated;

comment on function public.get_operator_pod_history_collections_v1(uuid,uuid,integer,integer,timestamptz,text) is
  'Globally pages a snapshot of the canonical POD history and rejects later pages after any collection revision change.';

create or replace function public.get_operator_pod_history_collections_v1(
  _tenant_id uuid,_document_id uuid,_page integer default 1,_page_size integer default 25
) returns jsonb language sql stable security definer set search_path=''
as $function$
  select public.get_operator_pod_history_collections_v1(_tenant_id,_document_id,_page,_page_size,null,null);
$function$;
