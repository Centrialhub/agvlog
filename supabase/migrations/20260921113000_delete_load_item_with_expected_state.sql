create or replace function public.delete_load_item_v4(
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

revoke all on function public.delete_load_item_v4(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.delete_load_item_v4(uuid, uuid, jsonb) to authenticated;

comment on function public.delete_load_item_v4(uuid, uuid, jsonb) is
  'Deletes a manual load item only when its complete preparation state still matches the operator snapshot.';
