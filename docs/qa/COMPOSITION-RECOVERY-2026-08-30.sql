-- LOCAL REHEARSAL ARTIFACT. Not a rollout authorization.
-- Restores exactly four captured functions, only if all 14 dependency contracts still match.
-- No load, item, stop, document, audit or financial row is deleted or rewritten.
-- Prefer roll-forward: these legacy functions contain the reproduced vulnerabilities.
-- Coordinate frontend compatibility before restoring. Execute as one transaction only.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $recovery_guard$
declare expected record; target oid;
begin
  for expected in select * from(values
    ('public._load_is_locked(uuid)','a15b8a40dfd93a05479f8cc0b04db3eb',false,true),
    ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','5ad09d2beee5b419d9af5ebd5eb96753',true,true),
    ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','1dfac4d7f001d60ac388f7767609a3cf',true,false),
    ('public.delete_load_item_v3(uuid,uuid)','4d28b1e151579934386be2ec0b8833c5',true,false),
    ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7ac9704abb7f610328b22b1e9f129d99',true,true),
    ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','cb97d4e58d535240efc9be062cbd1593',true,true),
    ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','385f77f83284de737f01eeba4d466f53',true,false),
    ('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)','62f819a77731d9fc694d7cd9bc4fe0db',true,false),
    ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4',false,true),
    ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d',false,true),
    ('public.recalculate_load_totals(uuid,uuid)','b1db75fc257d1279f5bd0ab4f1f1acf8',false,true),
    ('public.trg_handle_empty_load_on_doc_change()','a0e0758aa917356d938277bf7026565e',false,true),
    ('public.delete_load_if_empty(uuid)','d724afa8cce7714aae6c4deedf00e7a3',false,true),
    ('public.delete_load_safely(uuid,uuid)','67ab76c6b2de56f9f7392e0567a9026f',true,true)
  ) contract(signature,hash,authenticated,service_role) loop
    target:=to_regprocedure(expected.signature);
    if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from expected.hash
      or has_function_privilege('anon',target,'execute')
      or has_function_privilege('authenticated',target,'execute') is distinct from expected.authenticated
      or has_function_privilege('service_role',target,'execute') is distinct from expected.service_role then
      raise exception 'Composition recovery refused: contract changed %',expected.signature;
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.load_items'::regclass and tgname='trg_recalc_load_totals'
    and tgfoid='public.recalc_load_totals()'::regprocedure and tgtype=29 and tgenabled='O' and not tgisinternal
    and not tgdeferrable and tgnargs=0 and tgqual is null) then raise exception 'Composition recovery refused: totals trigger changed';end if;
end;
$recovery_guard$;

CREATE OR REPLACE FUNCTION public._load_is_locked(_load_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.loads l
    WHERE l.id = _load_id
      AND (l.status IN ('in_transit','delivered','partial_delivery','returned','refused','failed','cancelled')
           OR EXISTS (SELECT 1 FROM public.dispatch_trips dt
                       WHERE dt.load_id = l.id AND dt.status IN ('in_progress','completed'))
           OR EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl
                       JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
                       WHERE dtl.load_id = l.id AND dt.status IN ('in_progress','completed')))
  );
$function$
;
revoke all on function public._load_is_locked(uuid) from public,anon,authenticated,service_role;
grant execute on function public._load_is_locked(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.move_load_items_between_loads(_tenant_id uuid, _source_load_id uuid, _target_load_id uuid, _item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_moved int; v_doc_ids uuid[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _source_load_id = _target_load_id THEN RAISE EXCEPTION 'same_load'; END IF;
  IF public._load_is_locked(_source_load_id) THEN RAISE EXCEPTION 'source_load_locked'; END IF;
  IF public._load_is_locked(_target_load_id) THEN RAISE EXCEPTION 'target_load_locked'; END IF;

  SELECT COALESCE(array_agg(DISTINCT fiscal_document_id) FILTER (WHERE fiscal_document_id IS NOT NULL),
                  ARRAY[]::uuid[])
    INTO v_doc_ids
  FROM public.load_items
  WHERE id = ANY(_item_ids) AND load_id = _source_load_id AND tenant_id = _tenant_id;

  UPDATE public.load_items
    SET load_id = _target_load_id, updated_at = now()
    WHERE id = ANY(_item_ids) AND load_id = _source_load_id AND tenant_id = _tenant_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  IF array_length(v_doc_ids, 1) IS NOT NULL THEN
    UPDATE public.fiscal_documents
      SET load_id = _target_load_id, updated_at = now()
      WHERE id = ANY(v_doc_ids) AND tenant_id = _tenant_id;
  END IF;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _source_load_id, 'move_items_out',
    NULL, jsonb_build_object('target_load_id', _target_load_id, 'item_ids', to_jsonb(_item_ids),
                             'document_ids', to_jsonb(v_doc_ids)), 'composition_rpc');
  PERFORM public._log_entity_audit(_tenant_id, 'load', _target_load_id, 'move_items_in',
    NULL, jsonb_build_object('source_load_id', _source_load_id, 'item_ids', to_jsonb(_item_ids),
                             'document_ids', to_jsonb(v_doc_ids)), 'composition_rpc');

  RETURN jsonb_build_object('moved', v_moved, 'document_ids', COALESCE(to_jsonb(v_doc_ids), '[]'::jsonb));
END $function$
;
revoke all on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) to authenticated;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.recalc_load_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.loads SET
    total_pallet_count = COALESCE((SELECT SUM(pallet_count) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    total_volume_m3 = COALESCE((SELECT SUM(volume_m3) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    updated_at = now()
  WHERE id = COALESCE(NEW.load_id, OLD.load_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
revoke all on function public.recalc_load_totals() from public,anon,authenticated,service_role;
grant execute on function public.recalc_load_totals() to service_role;

CREATE OR REPLACE FUNCTION public.delete_load_if_empty(v_load_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_doc_count INT;
    v_tenant_id UUID;
BEGIN
    IF v_load_id IS NULL THEN
        RETURN;
    END IF;

    -- Count active fiscal documents for this load
    SELECT count(*) INTO v_doc_count
    FROM public.fiscal_documents
    WHERE load_id = v_load_id 
      AND deleted_at IS NULL 
      AND status <> 'deleted';

    IF v_doc_count = 0 THEN
        SELECT tenant_id INTO v_tenant_id FROM public.loads WHERE id = v_load_id;
        
        IF v_tenant_id IS NOT NULL THEN
            -- delete_load_safely handles unlinking remaining items and deleting the load
            PERFORM public.delete_load_safely(v_tenant_id, v_load_id);
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$function$
;
revoke all on function public.delete_load_if_empty(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_if_empty(uuid) to service_role;

do $recovery_verification$
declare expected record; target oid;
begin
  for expected in select * from(values
    ('public._load_is_locked(uuid)','e77c73ef2b708130f34da83c2830c478',false,true),
    ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','5ad09d2beee5b419d9af5ebd5eb96753',true,true),
    ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','1dfac4d7f001d60ac388f7767609a3cf',true,false),
    ('public.delete_load_item_v3(uuid,uuid)','4d28b1e151579934386be2ec0b8833c5',true,false),
    ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7426489e533d6eecb3335dcd5bc1c8dd',true,true),
    ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','cb97d4e58d535240efc9be062cbd1593',true,true),
    ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','385f77f83284de737f01eeba4d466f53',true,false),
    ('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)','62f819a77731d9fc694d7cd9bc4fe0db',true,false),
    ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4',false,true),
    ('public.recalc_load_totals()','87b2082210a98ec8b9447543b6092e8e',false,true),
    ('public.recalculate_load_totals(uuid,uuid)','b1db75fc257d1279f5bd0ab4f1f1acf8',false,true),
    ('public.trg_handle_empty_load_on_doc_change()','a0e0758aa917356d938277bf7026565e',false,true),
    ('public.delete_load_if_empty(uuid)','242330e8795383f6d9e66cdb4cd83b3a',false,true),
    ('public.delete_load_safely(uuid,uuid)','67ab76c6b2de56f9f7392e0567a9026f',true,true)
  ) contract(signature,hash,authenticated,service_role) loop
    target:=to_regprocedure(expected.signature);
    if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from expected.hash
      or has_function_privilege('anon',target,'execute')
      or has_function_privilege('authenticated',target,'execute') is distinct from expected.authenticated
      or has_function_privilege('service_role',target,'execute') is distinct from expected.service_role then
      raise exception 'Composition recovery refused: contract changed %',expected.signature;
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.load_items'::regclass and tgname='trg_recalc_load_totals'
    and tgfoid='public.recalc_load_totals()'::regprocedure and tgtype=29 and tgenabled='O' and not tgisinternal
    and not tgdeferrable and tgnargs=0 and tgqual is null) then raise exception 'Composition recovery refused: totals trigger changed';end if;
end;
$recovery_verification$;
commit;
