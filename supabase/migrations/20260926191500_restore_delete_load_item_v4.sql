-- Restore the published RPC only when its signature is absent. Existing definitions and ACLs stay intact.
do $restore$
declare
  v_missing_columns text;
begin
  if to_regprocedure('public.delete_load_item_v4(uuid,uuid,jsonb)') is not null then
    return;
  end if;
  if to_regclass('public.load_items') is null
    or to_regclass('public.current_load_items') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null
    or to_regprocedure('public._lock_load_document_graph(uuid,uuid)') is null
    or to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)') is null
    or to_regprocedure('public.delete_load_if_empty(uuid)') is null
    or to_regrole('anon') is null
    or to_regrole('authenticated') is null
    or to_regrole('service_role') is null then
    raise exception '20260926191500_restore_delete_load_item_v4.sql_dependency_missing';
  end if;
  select string_agg(format('%I.%I', required.relation_name, required.column_name), ', '
                    order by required.relation_name, required.column_name)
    into v_missing_columns
  from (values
      ('load_items', 'id'),
      ('load_items', 'tenant_id'),
      ('load_items', 'load_id'),
      ('load_items', 'order_id'),
      ('load_items', 'item_description'),
      ('load_items', 'quantity'),
      ('load_items', 'pallet_count'),
      ('load_items', 'weight_kg'),
      ('load_items', 'volume_m3'),
      ('load_items', 'status'),
      ('load_items', 'notes'),
      ('load_items', 'updated_at'),
      ('load_items', 'fiscal_document_id'),
      ('current_load_items', 'id'),
      ('current_load_items', 'tenant_id'),
      ('current_load_items', 'load_id'),
      ('current_load_items', 'order_id'),
      ('current_load_items', 'item_description'),
      ('current_load_items', 'quantity'),
      ('current_load_items', 'pallet_count'),
      ('current_load_items', 'weight_kg'),
      ('current_load_items', 'volume_m3'),
      ('current_load_items', 'status'),
      ('current_load_items', 'notes'),
      ('current_load_items', 'updated_at'),
      ('current_load_items', 'fiscal_document_id')
  ) as required(relation_name, column_name)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.' || required.relation_name)
      and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped
  );
  if v_missing_columns is not null then
    raise exception '20260926191500_restore_delete_load_item_v4.sql_column_missing: %', v_missing_columns;
  end if;

  execute $definition$
create function public.delete_load_item_v4(
  p_tenant_id uuid,
  p_item_id uuid,
  p_expected jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_load uuid;
  v_item public.load_items%rowtype;
  v_actual jsonb;
  v_keys constant text[] := array[
    'order_id','item_description','quantity','pallet_count','weight_kg',
    'volume_m3','status','notes','updated_at'
  ];
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object'
     or not (p_expected ?& v_keys)
     or exists (select 1 from jsonb_object_keys(p_expected) key where key <> all(v_keys)) then
    raise exception 'invalid_load_item_expected' using errcode = '22023';
  end if;

  select load_id into v_load
  from public.current_load_items
  where id = p_item_id and tenant_id = p_tenant_id;
  if not found then return false; end if;

  perform public._lock_load_document_graph(p_tenant_id, v_load);
  select * into v_item
  from public.current_load_items
  where id = p_item_id and tenant_id = p_tenant_id and load_id = v_load
  for update nowait;
  if not found then raise exception 'composition_items_changed' using errcode = '40001'; end if;

  v_actual := jsonb_build_object(
    'order_id', v_item.order_id,
    'item_description', v_item.item_description,
    'quantity', v_item.quantity,
    'pallet_count', v_item.pallet_count,
    'weight_kg', v_item.weight_kg,
    'volume_m3', v_item.volume_m3,
    'status', v_item.status,
    'notes', v_item.notes,
    'updated_at', v_item.updated_at
  );
  if v_actual is distinct from p_expected then
    raise exception 'load_item_expected_changed' using errcode = '40001';
  end if;
  if v_item.fiscal_document_id is not null then
    raise exception 'document_remove_requires_document_api' using errcode = '23514';
  end if;

  delete from public.current_load_items where id = p_item_id;
  perform public._log_entity_audit(p_tenant_id, 'load_item', p_item_id, 'delete', to_jsonb(v_item), null, 'delete_load_item_v4');
  perform public.delete_load_if_empty(v_load);
  return true;
exception when lock_not_available then
  raise exception 'composition_concurrent_change' using errcode = '40001';
end;
$function$;
$definition$;
  revoke all on function public.delete_load_item_v4(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
  grant execute on function public.delete_load_item_v4(uuid,uuid,jsonb) to authenticated;
  comment on function public.delete_load_item_v4(uuid,uuid,jsonb) is
    'Deletes a manual load item only when its complete preparation state still matches the operator snapshot.';
end;
$restore$;
