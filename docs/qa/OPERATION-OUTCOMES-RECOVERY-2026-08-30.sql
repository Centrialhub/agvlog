-- LOCAL REHEARSAL ONLY: refuse after use; never erase business evidence.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.idempotency_keys in access exclusive mode;
lock table public.dispatch_events in access exclusive mode;
lock table public.delivery_document_outcomes in access exclusive mode;
do $guard$
declare c record;target oid;
begin
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body' and atttypid='jsonb'::regtype and not attnotnull and not atthasdef and not attisdropped)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8')
  or exists(select 1 from pg_trigger where tgname in('capture_driver_document_outcomes','preserve_delivery_document_outcome') and tgenabled<>'O') then
  raise exception 'Operational outcome recovery refused: cache or trigger contract changed';end if;
 for c in select * from(values ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','6664818c64d992c324fa57bc2cdfd535',true,true),
('public._delivery_result_from_statuses(text[])','2acc28ff3b14abf6153a535f8b3c23f6',false,false),
('public._preserve_delivery_document_outcome()','d64c6d648e261271ac86a97e46701450',false,false),
('public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamptz)','87045bcd032515b747b8427f76d10626',false,false),
('public._capture_driver_document_outcomes()','0c2926ed7b8fb5600348db2ef3d523ac',false,false),
('public._operation_document_context(uuid,uuid,uuid)','dd57aa341cb02a3358258097408fdfb3',false,false),
('public.get_operation_document_context(uuid,uuid,uuid)','6dfa1b18d9b725d645ab5d471afc7623',true,false),
('public.record_operation_document_outcome(jsonb)','11ae3f47818aaf4a239279ab33926b4f',true,false),
('public._lock_delivery_trip_graph(uuid,uuid)','ffa8920db62358d266660d11685ed9c0',false,false),
('public._derive_driver_delivery_result(uuid,uuid)','31a4a4ec4f9a00f7bf7df2f96ede223a',false,false),
('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa',true,true)) expected(signature,hash,authenticated,service_role) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_role then raise exception 'Operational outcome recovery refused: function contract changed %',c.signature;end if;
 end loop;
 -- PostgreSQL 18 adds table NOT NULL entries to pg_constraint; 17 does not.
 -- Hash NOT NULL exactly once via pg_attribute.attnotnull on both versions.
 if md5((jsonb_build_object('columns',(select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,pg_get_expr(adbin,adrelid)) order by attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.delivery_document_outcomes'::regclass and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where contype<>'n' and conrelid='public.delivery_document_outcomes'::regclass),
 'policies',(select jsonb_agg(jsonb_build_array(polname,polcmd,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid),(select array_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(polroles))) order by polname) from pg_policy where polrelid='public.delivery_document_outcomes'::regclass),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where (tgrelid='public.delivery_document_outcomes'::regclass or tgname='capture_driver_document_outcomes') and not tgisinternal)))::text) is distinct from 'b7104361d58d881172a72b2edb849d7f'
  or not (select relrowsecurity from pg_class where oid='public.delivery_document_outcomes'::regclass)
  or not has_table_privilege('authenticated','public.delivery_document_outcomes','select')
  or not has_table_privilege('service_role','public.delivery_document_outcomes','select')
  or has_table_privilege('anon','public.delivery_document_outcomes','select')
  or has_table_privilege('authenticated','public.delivery_document_outcomes','insert,update,delete')
  or has_table_privilege('service_role','public.delivery_document_outcomes','insert,update,delete') then
  raise exception 'Operational outcome recovery refused: history schema or privileges changed';end if;
 if exists(select 1 from public.delivery_document_outcomes)
  or exists(select 1 from public.idempotency_keys where operation='record_operation_document_outcome')
  or exists(select 1 from public.entity_audit_log where source='operation_document_outcome') then
  raise exception 'Operational outcome recovery refused: business use exists; preserve history and roll forward';end if;
end;
$guard$;
drop trigger capture_driver_document_outcomes on public.dispatch_events;
CREATE OR REPLACE FUNCTION public.driver_record_delivery_outcome(_stop_id uuid, _outcome text, _details jsonb DEFAULT '{}'::jsonb, _client_event_id uuid DEFAULT NULL::uuid, _expected_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) to authenticated;
grant execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) to service_role;
CREATE OR REPLACE FUNCTION public._delivery_result_from_statuses(_statuses text[])
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$
;
revoke all on function public._delivery_result_from_statuses(text[]) from public,anon,authenticated,service_role;

drop function public.record_operation_document_outcome(jsonb);
drop function public.get_operation_document_context(uuid,uuid,uuid);
drop function public._operation_document_context(uuid,uuid,uuid);
drop function public._capture_driver_document_outcomes();
drop function public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamptz);
drop table public.delivery_document_outcomes;
drop function public._preserve_delivery_document_outcome();
commit;
