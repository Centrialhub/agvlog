-- LOCAL REHEARSAL ONLY. Before first use; after use, roll forward.
-- Does not reverse business records, clear keys or erase audit/evidence.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.idempotency_keys in access exclusive mode;
do $guard$
declare c record;target oid;
begin
 if to_regprocedure('public.record_operation_document_outcome(jsonb)') is not null then
  raise exception 'Item preparation recovery refused: newer operational outcome layer exists';end if;
 for c in select * from(values
 ('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)','04a3da6fbb4fe20bf8fc0ef4d59d7908',true,false),
 ('public.save_load_item_preparation(jsonb)','effc26025f50cecaa5dd5c44818de186',true,false),
 ('public._lock_load_document_graph(uuid,uuid)','56f03495204150746ffd94a12a25b340',false,false),
 ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275',false,false),
 ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d',false,true),
 ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4',false,true),
 ('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa',true,true)
 ) expected(signature,hash,authenticated,service_role) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_role then
    raise exception 'Item preparation recovery refused: contract changed %',c.signature;end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body'
   and atttypid='jsonb'::regtype and not attnotnull and not atthasdef and not attisdropped)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
   raise exception 'Item preparation recovery refused: request cache changed';end if;
 if exists(select 1 from public.idempotency_keys where operation='save_load_item_preparation')
  or exists(select 1 from public.entity_audit_log where source='item_preparation') then
   raise exception 'Item preparation recovery refused: business usage exists; preserve history and roll forward';end if;
end;
$guard$;
drop function public.save_load_item_preparation(jsonb);
CREATE OR REPLACE FUNCTION public.upsert_load_item_v3(p_tenant_id uuid, p_load_id uuid DEFAULT NULL::uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_item_description text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_pallet_count numeric DEFAULT NULL::numeric, p_weight_kg numeric DEFAULT NULL::numeric, p_volume_m3 numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_fiscal_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.load_items;
  v_item_id uuid;
  v_load_id uuid;
  v_fiscal_document_id uuid;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT * INTO v_item
    FROM public.load_items
    WHERE id = p_item_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'load_item_not_found'; END IF;
    IF p_load_id IS NOT NULL AND p_load_id <> v_item.load_id THEN
      RAISE EXCEPTION 'load_change_requires_move_rpc';
    END IF;
    v_load_id := v_item.load_id;
  ELSE
    v_load_id := p_load_id;
  END IF;

  IF v_load_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.loads WHERE id = v_load_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;
  IF public._load_is_locked(v_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  IF p_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF p_fiscal_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_documents WHERE id = p_fiscal_document_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'fiscal_document_not_found';
  END IF;
  IF p_status IS NOT NULL AND p_status <> ALL(ARRAY[
    'pending', 'waiting_conference', 'in_stock', 'picking', 'ready_for_load',
    'in_loading', 'loaded', 'in_transit', 'delivered', 'divergence', 'return', 'redelivery'
  ]) THEN
    RAISE EXCEPTION 'invalid_load_item_status';
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO public.load_items (
      tenant_id, load_id, order_id, fiscal_document_id, item_description,
      quantity, pallet_count, weight_kg, volume_m3, status, notes
    ) VALUES (
      p_tenant_id, v_load_id, p_order_id, p_fiscal_document_id,
      COALESCE(p_item_description, ''), COALESCE(p_quantity, 0),
      COALESCE(p_pallet_count, 0), COALESCE(p_weight_kg, 0), COALESCE(p_volume_m3, 0),
      COALESCE(p_status, 'pending'), p_notes
    ) RETURNING id, fiscal_document_id INTO v_item_id, v_fiscal_document_id;
  ELSE
    UPDATE public.load_items
    SET order_id = COALESCE(p_order_id, order_id),
        item_description = COALESCE(p_item_description, item_description),
        quantity = COALESCE(p_quantity, quantity),
        pallet_count = COALESCE(p_pallet_count, pallet_count),
        weight_kg = COALESCE(p_weight_kg, weight_kg),
        volume_m3 = COALESCE(p_volume_m3, volume_m3),
        status = COALESCE(p_status, status),
        notes = COALESCE(p_notes, notes),
        fiscal_document_id = COALESCE(p_fiscal_document_id, fiscal_document_id),
        updated_at = now()
    WHERE id = p_item_id AND tenant_id = p_tenant_id
    RETURNING id, fiscal_document_id INTO v_item_id, v_fiscal_document_id;
  END IF;

  IF v_fiscal_document_id IS NOT NULL THEN
    UPDATE public.fiscal_documents
    SET load_id = v_load_id, updated_at = now()
    WHERE id = v_fiscal_document_id AND tenant_id = p_tenant_id;
  END IF;

  PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);
  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load_item',
    v_item_id,
    CASE WHEN p_item_id IS NULL THEN 'create' ELSE 'update' END,
    NULL,
    jsonb_build_object('load_id', v_load_id, 'status', COALESCE(p_status, v_item.status, 'pending')),
    'upsert_load_item_v3'
  );

  RETURN v_item_id;
END;
$function$
;
revoke all on function public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated;
commit;
