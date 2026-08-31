-- One lock order: trip -> canonical links -> loads -> stops -> document links -> documents.
-- Private helpers are not API endpoints. No historical data is rewritten here.
-- Additive phase only: do not replace existing delivery/aggregate APIs here.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $preflight$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public._lock_delivery_trip_graph(uuid,uuid)', 'public._lock_driver_delivery_stop(uuid)',
    'public._delivery_result_from_statuses(text[])', 'public._derive_driver_delivery_result(uuid,uuid)',
    'public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)', 'public.driver_record_delivery_note(uuid,text,jsonb,uuid)'
  ] loop
    if to_regprocedure(v_signature) is not null then
      raise exception 'Additive delivery object already exists: %; inspect contract before deployment',v_signature;
    end if;
  end loop;
  if to_regclass('public.dispatch_events_delivery_request_key_idx') is not null then
    raise exception 'Delivery request index already exists; inspect before deployment';
  end if;
end;
$preflight$;

create function public._lock_delivery_trip_graph(_tenant_id uuid, _trip_id uuid)
returns public.dispatch_trips
language plpgsql security invoker set search_path = ''
as $fn$
declare v_trip public.dispatch_trips%rowtype;
begin
  select * into v_trip from public.dispatch_trips
  where id=_trip_id and tenant_id=_tenant_id for update;
  if not found then raise exception 'Viagem não encontrada' using errcode='P0002'; end if;
  -- Parent FK locks prevent new links while the trip is locked, but do not stop
  -- deletion or non-key updates of existing links. Lock those rows explicitly.
  perform tl.id from public.dispatch_trip_loads tl where tl.dispatch_trip_id=_trip_id
    order by tl.load_id,tl.id for update;
  if exists(select 1 from public.dispatch_trip_loads tl left join public.loads l on l.id=tl.load_id
    where tl.dispatch_trip_id=_trip_id and (l.id is null or tl.tenant_id is distinct from _tenant_id or l.tenant_id is distinct from _tenant_id)) then
    raise exception 'Vínculo de carga fora do tenant' using errcode='23514';
  end if;
  perform l.id from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=_trip_id and tl.tenant_id=_tenant_id order by l.id for update of l;
  if exists(select 1 from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=_trip_id and l.trip_id is not null and l.trip_id<>_trip_id) then
    raise exception 'Carga reatribuída a outra viagem; solicite revisão' using errcode='23514';
  end if;
  if v_trip.load_id is not null and not exists(select 1 from public.dispatch_trip_loads
    where dispatch_trip_id=_trip_id and tenant_id=_tenant_id and load_id=v_trip.load_id) then
    raise exception 'Vínculo canônico da carga ausente' using errcode='23514';
  end if;
  perform id from public.dispatch_stops where dispatch_trip_id=_trip_id order by id for update;
  if exists(select 1 from public.dispatch_stops where dispatch_trip_id=_trip_id and tenant_id<>_tenant_id) then
    raise exception 'Parada fora do tenant' using errcode='23514';
  end if;
  perform d.id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id order by d.id for update of d;
  perform f.id from public.fiscal_documents f where f.id in (
    select d.fiscal_document_id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id) order by f.id for update;
  -- Delivery results apply to inbound cargo invoices, not issued fiscal output.
  -- Marking an outbound CT-e as failed would invoke fiscal release triggers.
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    join public.fiscal_documents f on f.id=d.fiscal_document_id
    where s.dispatch_trip_id=_trip_id and f.document_type is distinct from 'inbound') then
    raise exception 'Parada contém documento fiscal que não é nota de entrada; revise o vínculo na operação' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id group by d.fiscal_document_id having count(*)>1) then
    raise exception 'Documento vinculado a mais de uma parada nesta viagem' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    left join public.fiscal_documents f on f.id=d.fiscal_document_id
    where s.dispatch_trip_id=_trip_id and (d.tenant_id<>_tenant_id or f.id is null or f.tenant_id<>_tenant_id
      or (d.load_id is not null and f.load_id is not null and d.load_id<>f.load_id)
      or (coalesce(d.load_id,f.load_id) is null and (select count(*) from public.dispatch_trip_loads where dispatch_trip_id=_trip_id)<>1)
      or (coalesce(d.load_id,f.load_id) is not null and not exists(select 1 from public.dispatch_trip_loads tl
        where tl.dispatch_trip_id=_trip_id and tl.tenant_id=_tenant_id and tl.load_id=coalesce(d.load_id,f.load_id))))) then
    raise exception 'Documento da parada sem vínculo válido com a carga' using errcode='23514';
  end if;
  return v_trip;
end;
$fn$;
revoke all on function public._lock_delivery_trip_graph(uuid,uuid) from public,anon,authenticated,service_role;

create function public._lock_driver_delivery_stop(_stop_id uuid)
returns public.dispatch_stops
language plpgsql security invoker set search_path = ''
as $fn$
declare v_stop public.dispatch_stops%rowtype; v_trip public.dispatch_trips%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='42501'; end if;
  select * into v_stop from public.dispatch_stops where id=_stop_id;
  if not found then raise exception 'Parada não encontrada' using errcode='P0002'; end if;
  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);
  select * into v_trip from public._lock_delivery_trip_graph(v_stop.tenant_id,v_stop.dispatch_trip_id);
  perform public._assert_driver_owns_trip(v_trip.id);
  select * into v_stop from public.dispatch_stops where id=_stop_id and dispatch_trip_id=v_trip.id and tenant_id=v_trip.tenant_id;
  if not found then raise exception 'Parada reatribuída; atualize a viagem' using errcode='40001'; end if;
  if v_trip.actual_start_at is null or v_trip.status is null or v_trip.status not in ('in_transit','in_progress','completed') then
    raise exception 'Inicie a viagem antes de registrar a entrega' using errcode='23514';
  end if;
  return v_stop;
end;
$fn$;
revoke all on function public._lock_driver_delivery_stop(uuid) from public,anon,authenticated,service_role;

create function public._delivery_result_from_statuses(_statuses text[])
returns text language plpgsql immutable set search_path = ''
as $fn$
begin
  if coalesce(cardinality(_statuses),0)=0 or exists(select 1 from unnest(_statuses) s
    where s is null or s not in('delivered','completed','partial_delivery','returned','refused','failed','cancelled','skipped')) then return null; end if;
  if not exists(select 1 from unnest(_statuses) s where s not in('delivered','completed')) then return 'delivered'; end if;
  if _statuses && array['delivered','completed','partial_delivery'] then return 'partial_delivery'; end if;
  if not exists(select 1 from unnest(_statuses) s where s<>'returned') then return 'returned'; end if;
  if not exists(select 1 from unnest(_statuses) s where s<>'refused') then return 'refused'; end if;
  if not exists(select 1 from unnest(_statuses) s where s<>'cancelled') then return 'cancelled'; end if;
  return 'failed';
end;
$fn$;
revoke all on function public._delivery_result_from_statuses(text[]) from public,anon,authenticated,service_role;

create function public._derive_driver_delivery_result(p_tenant_id uuid,p_trip_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare v_trip public.dispatch_trips%rowtype; v_load public.loads%rowtype; v_count integer;
  v_statuses text[]; v_result text; v_all_terminal boolean; v_missing boolean := false;
begin
  select * into v_trip from public._lock_delivery_trip_graph(p_tenant_id,p_trip_id);
  if v_trip.actual_start_at is null or v_trip.status is null or v_trip.status not in('in_transit','in_progress','completed') then
    raise exception 'Viagem sem início válido para concluir entregas' using errcode='23514';
  end if;
  select count(*) into v_count from public.dispatch_trip_loads where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  select coalesce(bool_and(coalesce(status in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed'),false)),false)
    into v_all_terminal from public.dispatch_stops where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  if v_count=0 then raise exception 'Viagem sem cargas vinculadas' using errcode='23514'; end if;
  -- A single-load trip unambiguously owns its stops. Shared trips require explicit document allocations.
  if v_count>1 and v_all_terminal and exists(select 1 from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and not exists(select 1 from public.dispatch_stop_documents d
      join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and coalesce(d.load_id,f.load_id) is not null)) then
    raise exception 'Parada sem carga identificada; revise os vínculos antes de concluir' using errcode='23514';
  end if;
  for v_load in select l.* from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=p_trip_id and tl.tenant_id=p_tenant_id order by l.id loop
    -- A partial stop can fully deliver one document/load and return another.
    -- Use document outcomes for that stop, not its aggregate label for every load.
    select array_agg(case when s.status='partial_delivery' then (
      select public._delivery_result_from_statuses(array_agg(f.status))
      from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id
        and (v_count=1 or coalesce(d.load_id,f.load_id)=v_load.id)
    ) else s.status end) into v_statuses from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and s.tenant_id=p_tenant_id and (v_count=1 or exists(
      select 1 from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id and coalesce(d.load_id,f.load_id)=v_load.id));
    v_result := public._delivery_result_from_statuses(v_statuses);
    if coalesce(cardinality(v_statuses),0)=0 or (v_all_terminal and v_result is null) then v_missing:=true; end if;
    if v_result is not null and v_load.status is distinct from v_result then
      if v_load.status in('delivered','cancelled','returned','refused','partial_delivery','failed') then
        raise exception 'Carga possui resultado final divergente; solicite revisão' using errcode='23514';
      end if;
      update public.loads set status=v_result,updated_at=clock_timestamp() where id=v_load.id and tenant_id=p_tenant_id;
      perform public._log_entity_audit(p_tenant_id,'load',v_load.id,'status_change',
        jsonb_build_object('status',v_load.status),jsonb_build_object('status',v_result,'trip_id',p_trip_id),'delivery_outcome');
    end if;
  end loop;
  if v_all_terminal then
    if v_missing then raise exception 'Carga sem parada identificada; revise os vínculos antes de concluir' using errcode='23514'; end if;
    if v_trip.actual_start_at is null then raise exception 'Viagem sem início registrado' using errcode='23514'; end if;
    update public.dispatch_trips set status='completed',actual_end_at=coalesce(actual_end_at,clock_timestamp()),updated_at=clock_timestamp()
      where id=p_trip_id and tenant_id=p_tenant_id and status<>'completed';
  end if;
end;
$fn$;
revoke all on function public._derive_driver_delivery_result(uuid,uuid) from public,anon,authenticated,service_role;

-- The index also serializes reuse of a request key on different trips. Only
-- canonical outcome events participate; informational payloads cannot spoof a replay.
create unique index if not exists dispatch_events_delivery_request_key_idx
  on public.dispatch_events(tenant_id,created_by,(payload->>'client_event_id'))
  where payload->>'client_event_id' is not null and payload ? 'delivery_request'
    and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled');

create function public.driver_record_delivery_outcome(
  _stop_id uuid,_outcome text,_details jsonb default '{}'::jsonb,
  _client_event_id uuid default null,_expected_status text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_stop public.dispatch_stops%rowtype; v_trip public.dispatch_trips%rowtype;
  v_existing public.dispatch_events%rowtype; v_event uuid; v_occurrence uuid; v_pod uuid;
  v_pods uuid[] := array[]::uuid[]; v_docs uuid[]; v_loads uuid[];
  v_details jsonb; v_request jsonb; v_result jsonb; v_photos jsonb; v_items jsonb;
  v_notes text; v_receiver text; v_signature text; v_path text; v_prefix text;
  v_fd record; v_item record; v_quantity numeric; v_returned numeric := 0; v_total numeric;
  v_doc_total numeric; v_doc_returned numeric; v_doc_outcome text; v_single_load uuid;
begin
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  select * into v_trip from public.dispatch_trips where id=v_stop.dispatch_trip_id;
  if _outcome is null or _outcome not in('delivered','partial_delivery','returned','refused','failed','skipped','cancelled') then
    raise exception 'Resultado de entrega inválido' using errcode='22023'; end if;
  if _details is null or jsonb_typeof(_details)<>'object' or octet_length(_details::text)>131072 then
    raise exception 'Dados de entrega inválidos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(_details) x where x.key in('notes','return_reason','receiver_name','receiver_document','receiver_role','signature_path','event_label')
    and jsonb_typeof(x.value) not in('string','null')) then
    raise exception 'Campo de texto inválido' using errcode='22023'; end if;
  v_notes:=coalesce(nullif(btrim(_details->>'notes'),''),nullif(btrim(_details->>'return_reason'),''));
  v_receiver:=nullif(btrim(coalesce(_details->>'receiver_name','')),'');
  v_signature:=nullif(btrim(coalesce(_details->>'signature_path','')),'');
  v_photos:=coalesce(_details->'photo_paths','[]'::jsonb);
  v_items:=coalesce(_details->'returned_items','{}'::jsonb);
  if jsonb_typeof(v_photos)<>'array' or jsonb_array_length(v_photos)>5 or jsonb_typeof(v_items)<>'object'
    or length(coalesce(v_notes,''))>2000 or length(coalesce(v_receiver,''))>160
    or length(coalesce(_details->>'receiver_document',''))>80 or length(coalesce(_details->>'receiver_role',''))>80 then
    raise exception 'Dados de entrega inválidos' using errcode='22023'; end if;
  v_details:=_details || jsonb_build_object('notes',v_notes,'receiver_name',v_receiver,'signature_path',v_signature,
    'photo_paths',v_photos,'returned_items',v_items);
  v_request:=jsonb_build_object('outcome',_outcome,'details',v_details);
  -- Resolve a lost response before checking files again: a committed result is immutable.
  select * into v_existing from public.dispatch_events
    where tenant_id=v_stop.tenant_id and created_by=auth.uid()
      and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled')
      and ((_client_event_id is not null and payload->>'client_event_id'=_client_event_id::text)
        or (_client_event_id is null and dispatch_stop_id=_stop_id and payload->'delivery_request'=v_request))
      and payload ? 'delivery_result' order by event_at desc,created_at desc,id desc limit 1;
  if found then
    if v_existing.dispatch_stop_id<>_stop_id or v_existing.payload->'delivery_request' is distinct from v_request then
      raise exception 'Identificador reutilizado para outra entrega' using errcode='23505'; end if;
    return (v_existing.payload->'delivery_result') || jsonb_build_object('replayed',true);
  end if;
  if _expected_status is not null and _expected_status is distinct from v_stop.status then
    raise exception 'A parada mudou. Atualize antes de confirmar.' using errcode='40001'; end if;
  if v_stop.status is null or v_stop.status=any(public.stop_terminal_statuses()) or v_trip.status='completed' then
    raise exception 'Parada já finalizada; solicite revisão à operação' using errcode='23514'; end if;
  if _outcome not in('skipped','cancelled') and v_stop.actual_arrival_at is null then
    raise exception 'Registre a chegada antes de informar o resultado' using errcode='23514'; end if;
  if _outcome<>'delivered' and length(coalesce(v_notes,''))<3 then
    raise exception 'Informe o motivo do resultado da entrega' using errcode='22023'; end if;
  if _outcome in('delivered','partial_delivery') and length(coalesce(v_receiver,''))<2 then
    raise exception 'Informe o recebedor' using errcode='22023'; end if;
  if _outcome in('delivered','partial_delivery') and (v_signature is null or jsonb_array_length(v_photos)=0) then
    raise exception 'Foto e assinatura são obrigatórias para comprovar a entrega' using errcode='22023'; end if;
  v_prefix:=v_stop.tenant_id::text || '/deliveries/' || v_trip.id::text || '/' || _stop_id::text || '/';
  if exists(select 1 from jsonb_array_elements(v_photos) p where jsonb_typeof(p)<>'string') then
    raise exception 'Caminho de foto inválido' using errcode='22023'; end if;
  for v_path in select value from jsonb_array_elements_text(v_photos) union all select v_signature where v_signature is not null loop
    if v_path is null or length(v_path)>500 or position('..' in v_path)>0 or left(v_path,length(v_prefix))<>v_prefix
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_path) then
      raise exception 'Comprovante inexistente ou fora desta entrega' using errcode='42501'; end if;
  end loop;
  -- Lock quantities in stable order before validating item-level outcomes.
  perform li.id from public.load_items li where exists(select 1 from public.dispatch_stop_documents d
    where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id) order by li.id for share;
  if exists(select 1 from public.load_items li join public.fiscal_documents f on f.id=li.fiscal_document_id
    join public.dispatch_stop_documents d on d.fiscal_document_id=f.id where d.dispatch_stop_id=_stop_id
    and (li.tenant_id is distinct from v_stop.tenant_id or (li.load_id is not null and coalesce(d.load_id,f.load_id) is not null
      and li.load_id<>coalesce(d.load_id,f.load_id)))) then
    raise exception 'Itens fora do vínculo de carga da parada' using errcode='23514'; end if;
  for v_item in select key,value from jsonb_each(v_items) loop
    if v_item.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item.value)<>'number' then raise exception 'Item devolvido inválido' using errcode='22023'; end if;
    select li.quantity into v_quantity from public.load_items li
      where li.id=v_item.key::uuid and li.tenant_id=v_stop.tenant_id and exists(select 1 from public.dispatch_stop_documents d
        where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id and d.fiscal_document_id=li.fiscal_document_id) for share;
    if not found or v_quantity is null or (v_item.value::text)::numeric<=0 or (v_item.value::text)::numeric>v_quantity then
      raise exception 'Quantidade devolvida fora dos itens desta parada' using errcode='22023'; end if;
    v_returned:=v_returned+(v_item.value::text)::numeric;
  end loop;
  if _outcome in('delivered','failed','skipped','cancelled') and v_returned>0 then
    raise exception 'Resultado incompatível com itens devolvidos' using errcode='22023'; end if;
  if _outcome='partial_delivery' then
    select sum(li.quantity) into v_total from public.load_items li where li.tenant_id=v_stop.tenant_id and exists(
      select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id and d.tenant_id=v_stop.tenant_id);
    if v_returned<=0 or v_total is null or v_returned>=v_total then
      raise exception 'Entrega parcial exige quantidade devolvida menor que o total' using errcode='22023'; end if;
  end if;
  if _outcome in('returned','refused') and v_returned>0 then
    if exists(select 1 from public.load_items li where exists(select 1 from public.dispatch_stop_documents d
      where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id)
      and (li.quantity is null or li.quantity<=0 or coalesce((v_items->>li.id::text)::numeric,0)<>li.quantity)) then
      raise exception 'Devolução total exige todos os itens, ou apenas o motivo quando não detalhados' using errcode='22023'; end if;
  end if;
  select case when count(*)=1 then (array_agg(load_id))[1] end into v_single_load
    from public.dispatch_trip_loads where dispatch_trip_id=v_trip.id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct fiscal_document_id) into v_docs from public.dispatch_stop_documents
    where dispatch_stop_id=_stop_id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct coalesce(d.load_id,f.load_id,v_single_load)) filter(where coalesce(d.load_id,f.load_id,v_single_load) is not null)
    into v_loads from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id;
  if v_loads is null and v_single_load is not null then v_loads:=array[v_single_load]; end if;
  -- Route the operational message before trip closure; the occurrence API requires an active trip.
  v_occurrence:=public.driver_create_operational_occurrence(v_trip.id,_outcome,
    coalesce(v_notes,'Entrega concluída por ' || v_receiver),case when _outcome='delivered' then 'low' else 'medium' end,_stop_id,null);
  update public.operational_events set
    load_id=case when cardinality(v_loads)=1 then v_loads[1] else null end,
    report_details=v_details || jsonb_build_object('label',coalesce(_details->>'event_label',_outcome),
      'has_photo',jsonb_array_length(v_photos)>0,'has_signature',v_signature is not null,'stop_name',v_stop.destination),
    payload=payload || jsonb_build_object('delivery_outcome',_outcome,'document_ids',coalesce(to_jsonb(v_docs),'[]'::jsonb),
      'load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb))
    where id=v_occurrence and tenant_id=v_stop.tenant_id;
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
    values(v_stop.tenant_id,v_trip.id,_stop_id,case when _outcome='delivered' then 'delivery_delivered' else 'stop_'||_outcome end,
      v_notes,v_details || jsonb_build_object('source','driver_app','client_event_id',_client_event_id,'delivery_request',v_request,'operational_event_id',v_occurrence),
      auth.uid(),clock_timestamp()) returning id into v_event;
  for v_fd in select f.id,coalesce(d.load_id,f.load_id,v_single_load) load_id,f.status from public.dispatch_stop_documents d
    join public.fiscal_documents f on f.id=d.fiscal_document_id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id order by f.id loop
    v_doc_outcome:=case when _outcome='skipped' then 'not_delivered' else _outcome end;
    if _outcome='partial_delivery' then
      select sum(li.quantity),sum(coalesce((v_items->>li.id::text)::numeric,0)) into v_doc_total,v_doc_returned
        from public.load_items li where li.fiscal_document_id=v_fd.id and li.tenant_id=v_stop.tenant_id;
      if v_doc_total is null or v_doc_total<=0 or exists(select 1 from public.load_items
        where fiscal_document_id=v_fd.id and (quantity is null or quantity<=0)) then
        raise exception 'Documento sem quantidades confiáveis para entrega parcial' using errcode='23514'; end if;
      v_doc_outcome:=case when v_doc_returned=0 then 'delivered' when v_doc_returned=v_doc_total then 'returned' else 'partial_delivery' end;
    end if;
    if v_fd.status in('delivered','returned','refused','partial_delivery','failed','cancelled','not_delivered') and v_fd.status<>v_doc_outcome then
      raise exception 'Documento possui resultado final divergente' using errcode='23514'; end if;
    if v_doc_outcome in('delivered','partial_delivery') then
      insert into public.proof_of_delivery as pod(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,
        proof_type,status,storage_bucket,storage_path,receiver_name,receiver_document,receiver_role,received_at,metadata,created_by)
      values(v_stop.tenant_id,v_fd.id,v_fd.load_id,v_trip.id,_stop_id,'receiver_confirmation','uploaded','receipts',v_signature,
        v_receiver,nullif(btrim(_details->>'receiver_document'),''),nullif(btrim(_details->>'receiver_role'),''),clock_timestamp(),
        jsonb_build_object('photo_paths',v_photos,'signature_path',v_signature,'event_id',v_event,'outcome',v_doc_outcome),auth.uid())
      on conflict(fiscal_document_id) do update set
        load_id=excluded.load_id,dispatch_trip_id=excluded.dispatch_trip_id,dispatch_stop_id=excluded.dispatch_stop_id,
        proof_type=excluded.proof_type,status=excluded.status,storage_bucket=excluded.storage_bucket,storage_path=excluded.storage_path,
        receiver_name=excluded.receiver_name,receiver_document=excluded.receiver_document,receiver_role=excluded.receiver_role,
        received_at=excluded.received_at,metadata=excluded.metadata,created_by=excluded.created_by,updated_at=clock_timestamp()
      where pod.tenant_id=excluded.tenant_id and pod.status in('pending','missing')
        and (pod.dispatch_trip_id is null or pod.dispatch_trip_id=excluded.dispatch_trip_id)
        and (pod.dispatch_stop_id is null or pod.dispatch_stop_id=excluded.dispatch_stop_id)
        and pod.storage_path is null and pod.photo_url is null and pod.signature_url is null and pod.received_at is null
        and pod.metadata='{}'::jsonb
      returning id into v_pod;
      if not found then raise exception 'Comprovante existente exige revisão; não será sobrescrito' using errcode='23514'; end if;
      v_pods:=array_append(v_pods,v_pod);
    end if;
    update public.fiscal_documents set status=v_doc_outcome,
      updated_at=clock_timestamp() where id=v_fd.id and tenant_id=v_stop.tenant_id;
    perform public._log_entity_audit(v_stop.tenant_id,'fiscal_document',v_fd.id,'status_change_by_driver',
      jsonb_build_object('status',v_fd.status),jsonb_build_object('status',v_doc_outcome,'stop_id',_stop_id),'delivery_outcome');
  end loop;
  update public.dispatch_stops set status=_outcome,notes=coalesce(v_notes,notes),
    actual_departure_at=case when actual_arrival_at is not null then coalesce(actual_departure_at,clock_timestamp()) else actual_departure_at end,
    updated_at=clock_timestamp() where id=_stop_id and tenant_id=v_stop.tenant_id;
  perform public._log_entity_audit(v_stop.tenant_id,'dispatch_stop',_stop_id,'status_change',
    jsonb_build_object('status',v_stop.status),jsonb_build_object('status',_outcome,'event_id',v_event),'delivery_outcome');
  perform public._derive_driver_delivery_result(v_stop.tenant_id,v_trip.id);
  v_result:=jsonb_build_object('event_id',v_event,'operational_event_id',v_occurrence,'pod_ids',to_jsonb(v_pods),
    'updated_stop_id',_stop_id,'updated_document_ids',coalesce(to_jsonb(v_docs),'[]'::jsonb),
    'updated_load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb),
    'trip_completed',(select status='completed' from public.dispatch_trips where id=v_trip.id),'replayed',false);
  update public.dispatch_events set payload=payload || jsonb_build_object('delivery_result',v_result) where id=v_event;
  return v_result;
end;
$fn$;
revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
-- Keep staged APIs private until legacy writers are cut over in one transaction.

-- Informational notes also reach operations atomically, including attachments.
-- A request is not approval, a financial instruction or a final delivery status.
create function public.driver_record_delivery_note(
  _stop_id uuid,_event_type text,_details jsonb,_client_event_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_stop public.dispatch_stops%rowtype; v_existing public.dispatch_events%rowtype;
  v_request jsonb; v_result jsonb; v_photos jsonb; v_signature text; v_path text; v_prefix text;
  v_note text; v_occurrence uuid; v_event uuid; v_loads uuid[]; v_single_load uuid;
begin
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  if _client_event_id is null or _event_type is null or _event_type not in('avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros')
    or _details is null or jsonb_typeof(_details)<>'object' or octet_length(_details::text)>131072 then
    raise exception 'Dados da comunicação inválidos' using errcode='22023'; end if;
  v_request:=jsonb_build_object('kind','note','event_type',_event_type,'details',_details);
  select * into v_existing from public.dispatch_events where tenant_id=v_stop.tenant_id and created_by=auth.uid()
    and payload->>'client_event_id'=_client_event_id::text and payload ? 'delivery_result'
    and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled')
    order by event_at desc,id desc limit 1;
  if found then
    if v_existing.dispatch_stop_id<>_stop_id or v_existing.payload->'delivery_request' is distinct from v_request then
      raise exception 'Identificador reutilizado para outra comunicação' using errcode='23505'; end if;
    return (v_existing.payload->'delivery_result') || jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from jsonb_each(_details) x where x.key in('notes','return_reason','event_label','signature_path')
    and jsonb_typeof(x.value) not in('string','null')) then
    raise exception 'Texto da comunicação inválido' using errcode='22023'; end if;
  v_note:=nullif(btrim(_details->>'notes'),'');
  if v_note is null or length(v_note)<3 or length(v_note)>2000 then
    raise exception 'Descreva a comunicação para a operação' using errcode='22023'; end if;
  v_photos:=coalesce(_details->'photo_paths','[]'::jsonb);
  v_signature:=nullif(btrim(_details->>'signature_path'),'');
  if jsonb_typeof(v_photos)<>'array' or jsonb_array_length(v_photos)>5 then
    raise exception 'Fotos inválidas' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(v_photos) p where jsonb_typeof(p)<>'string') then
    raise exception 'Caminho de foto inválido' using errcode='22023'; end if;
  if _event_type in('avaria','coleta_realizada') and jsonb_array_length(v_photos)=0 then
    raise exception 'Adicione uma foto da ocorrência' using errcode='22023'; end if;
  v_prefix:=v_stop.tenant_id::text || '/deliveries/' || v_stop.dispatch_trip_id::text || '/' || _stop_id::text || '/';
  for v_path in select value from jsonb_array_elements_text(v_photos) union all select v_signature where v_signature is not null loop
    if length(v_path)>500 or position('..' in v_path)>0 or left(v_path,length(v_prefix))<>v_prefix
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_path) then
      raise exception 'Comprovante inexistente ou fora desta entrega' using errcode='42501'; end if;
  end loop;
  select case when count(*)=1 then (array_agg(load_id))[1] end into v_single_load
    from public.dispatch_trip_loads where dispatch_trip_id=v_stop.dispatch_trip_id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct coalesce(d.load_id,f.load_id,v_single_load)) into v_loads
    from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id where d.dispatch_stop_id=_stop_id;
  if v_loads is null and v_single_load is not null then v_loads:=array[v_single_load]; end if;
  v_occurrence:=public.driver_create_operational_occurrence(v_stop.dispatch_trip_id,_event_type,v_note,'medium',_stop_id,null);
  update public.operational_events set load_id=case when cardinality(v_loads)=1 then v_loads[1] else null end,
    report_details=_details || jsonb_build_object('label',coalesce(_details->>'event_label',_event_type),
      'has_photo',jsonb_array_length(v_photos)>0,'has_signature',v_signature is not null,'stop_name',v_stop.destination),
    payload=payload || jsonb_build_object('load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb),'approval_granted',false)
    where id=v_occurrence and tenant_id=v_stop.tenant_id;
  v_result:=jsonb_build_object('operational_event_id',v_occurrence,'replayed',false);
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by)
    values(v_stop.tenant_id,v_stop.dispatch_trip_id,_stop_id,'delivery_note',v_note,
      _details || jsonb_build_object('client_event_id',_client_event_id,'delivery_request',v_request),auth.uid()) returning id into v_event;
  v_result:=v_result || jsonb_build_object('event_id',v_event);
  update public.dispatch_events set payload=payload || jsonb_build_object('delivery_result',v_result) where id=v_event;
  return v_result;
end;
$fn$;
revoke all on function public.driver_record_delivery_note(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
-- Granted by the legacy cutover, never while the old writers are still public.
