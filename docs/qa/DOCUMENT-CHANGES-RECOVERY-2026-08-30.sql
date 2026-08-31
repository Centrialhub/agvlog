-- LOCAL REHEARSAL ONLY. Restores five predecessor functions; does not reverse business edits.
-- Refuses any recorded use, including legacy wrapper calls. Prefer roll-forward after use.
-- Never delete cache or audits to make this guard pass. Coordinate frontend compatibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.idempotency_keys in access exclusive mode;
do $guard$
declare c record;target oid;
begin
 if to_regprocedure('public.record_operation_document_outcome(jsonb)') is not null then
  raise exception 'Document change recovery refused: newer operational outcome layer exists';end if;
 if to_regprocedure('public.save_load_item_preparation(jsonb)') is not null
  or md5(replace(pg_get_functiondef(to_regprocedure('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)')),E'\r\n',E'\n'))
    is distinct from '62f819a77731d9fc694d7cd9bc4fe0db' then
   raise exception 'Document change recovery refused: newer item preparation writer exists; recover in reverse order';
 end if;
 for c in select * from(values
  ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275',false,false),
  ('public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)','4709abef93d37fd2f61aca104bb8ca77',false,false),
  ('public._load_document_change_snapshot(uuid,uuid,uuid[])','3a6c5df0074fb6622405b64bdc397fd4',false,false),
  ('public._load_is_locked(uuid)','a15b8a40dfd93a05479f8cc0b04db3eb',false,true),
  ('public._load_replanning_snapshot(uuid,uuid[])','805fbe6706cde044e5904baaf6edea52',false,false),
  ('public._lock_load_document_graph(uuid,uuid)','56f03495204150746ffd94a12a25b340',false,false),
  ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4',false,true),
  ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','73793256599bf96b8232ddc15a68d166',true,true),
  ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','6ee516b30bc6d8fb5acdfd3a7820c9a4',true,false),
  ('public.change_load_documents(jsonb)','c6d375a215a500f8799426fe4290de65',true,false),
  ('public.delete_load_if_empty(uuid)','7e103b5a3c3c898aed492644c527c993',false,true),
  ('public.delete_load_item_v3(uuid,uuid)','fe43393cb817dfaa323e226e35a54566',true,false),
  ('public.get_load_document_change_context(uuid,uuid,uuid[])','4c45f2f4484c43d842dcbf1dd1732b7d',true,false),
  ('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa',true,true),
  ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d',false,true),
  ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','151cc5f78065f8cbce15464d9d088933',true,true),
  ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','c2220961533993d755e6cae225c402ca',true,false)
 ) expected(signature,hash,authenticated,service_role) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_role then
    raise exception 'Document change recovery refused: contract changed %',c.signature;
  end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
   raise exception 'Document change recovery refused: request cache changed';
 end if;
 if exists(select 1 from public.idempotency_keys where operation='change_load_documents')
  or exists(select 1 from public.entity_audit_log where source='document_composition') then
   raise exception 'Document change recovery refused: business usage exists; roll forward preserving evidence';
 end if;
end;
$guard$;
CREATE OR REPLACE FUNCTION public.assign_fiscal_documents_to_load(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_requested int := 0;
  v_blocked int := 0;
  v_doc_ids uuid[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _load_id IS NULL OR _document_ids IS NULL OR array_length(_document_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT array_agg(DISTINCT d.id)
    INTO v_doc_ids
  FROM unnest(_document_ids) AS d(id)
  WHERE d.id IS NOT NULL;

  IF v_doc_ids IS NULL OR array_length(v_doc_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF public._load_is_locked(_load_id) THEN
    RAISE EXCEPTION 'load_locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.loads l
    WHERE l.id = _load_id
      AND l.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;

  SELECT count(*)::int
    INTO v_requested
  FROM unnest(v_doc_ids) AS d(id);

  SELECT count(*)::int
    INTO v_blocked
  FROM public.fiscal_documents fd
  WHERE fd.id = ANY(v_doc_ids)
    AND fd.tenant_id = _tenant_id
    AND fd.load_id IS NOT NULL
    AND fd.load_id <> _load_id;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'document_already_linked';
  END IF;

  UPDATE public.fiscal_documents
    SET load_id = _load_id,
        updated_at = now()
    WHERE id = ANY(v_doc_ids)
      AND tenant_id = _tenant_id
      AND (load_id IS NULL OR load_id = _load_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> v_requested THEN
    RAISE EXCEPTION 'document_link_count_mismatch: expected %, updated %', v_requested, v_count;
  END IF;

  INSERT INTO public.load_items (
    tenant_id,
    load_id,
    fiscal_document_id,
    item_description,
    pallet_count,
    weight_kg,
    volume_m3
  )
  SELECT _tenant_id,
         _load_id,
         fd.id,
         COALESCE(NULLIF(fd.product_summary, ''), 'Documento ' || COALESCE(fd.invoice_number, fd.id::text)),
         COALESCE(fd.pallet_count, 0),
         COALESCE(fd.weight_kg, 0),
         0
  FROM public.fiscal_documents fd
  WHERE fd.id = ANY(v_doc_ids)
    AND fd.tenant_id = _tenant_id
    AND fd.load_id = _load_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.load_items li
      WHERE li.fiscal_document_id = fd.id
        AND li.load_id = _load_id
    );

  PERFORM public._log_entity_audit(
    _tenant_id,
    'load',
    _load_id,
    'assign_documents',
    NULL,
    jsonb_build_object('document_ids', to_jsonb(v_doc_ids), 'updated', v_count),
    'composition_rpc'
  );

  RETURN jsonb_build_object('updated', v_count, 'load_id', _load_id);
END $function$
;
revoke all on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]) to service_role;
CREATE OR REPLACE FUNCTION public.assign_fiscal_documents_to_load_v2(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.assign_fiscal_documents_to_load(_tenant_id, _load_id, _document_ids);
  PERFORM public.recalculate_load_totals(_tenant_id, _load_id);
  RETURN v_result || jsonb_build_object('totals_recalculated', true);
END;
$function$
;
revoke all on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) to authenticated;
CREATE OR REPLACE FUNCTION public.delete_load_item_v3(p_tenant_id uuid, p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_load_id uuid;
  v_fiscal_document_id uuid;
  v_old jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT li.load_id, li.fiscal_document_id, to_jsonb(li)
    INTO v_load_id, v_fiscal_document_id, v_old
  FROM public.load_items li
  WHERE li.id = p_item_id AND li.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF public._load_is_locked(v_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  DELETE FROM public.load_items
  WHERE id = p_item_id AND tenant_id = p_tenant_id;

  IF v_fiscal_document_id IS NOT NULL THEN
    UPDATE public.fiscal_documents
    SET load_id = NULL, updated_at = now()
    WHERE id = v_fiscal_document_id
      AND tenant_id = p_tenant_id
      AND load_id = v_load_id;
  END IF;

  PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);
  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load_item',
    p_item_id,
    'delete',
    v_old,
    NULL,
    'delete_load_item_v3'
  );
  RETURN true;
END;
$function$
;
revoke all on function public.delete_load_item_v3(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_item_v3(uuid,uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.remove_fiscal_documents_from_load(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF public._load_is_locked(_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  DELETE FROM public.load_items
    WHERE load_id = _load_id AND fiscal_document_id = ANY(_document_ids) AND tenant_id = _tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.fiscal_documents
    SET load_id = NULL, updated_at = now()
    WHERE id = ANY(_document_ids) AND tenant_id = _tenant_id AND load_id = _load_id;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _load_id, 'remove_documents',
    NULL, jsonb_build_object('document_ids', to_jsonb(_document_ids)), 'composition_rpc');

  RETURN jsonb_build_object('removed', v_count, 'load_id', _load_id);
END $function$
;
revoke all on function public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]) to service_role;
CREATE OR REPLACE FUNCTION public.remove_fiscal_documents_from_load_v2(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.remove_fiscal_documents_from_load(_tenant_id, _load_id, _document_ids);
  PERFORM public.recalculate_load_totals(_tenant_id, _load_id);
  RETURN v_result || jsonb_build_object('totals_recalculated', true);
END;
$function$
;
revoke all on function public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[]) to authenticated;
drop function public.change_load_documents(jsonb);
drop function public.get_load_document_change_context(uuid,uuid,uuid[]);
drop function public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text);
drop function public._load_document_change_snapshot(uuid,uuid,uuid[]);
drop function public._lock_load_document_graph(uuid,uuid);
commit;
