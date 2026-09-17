create or replace function public.move_load_items_between_loads(
  _tenant_id uuid,
  _source_load_id uuid,
  _target_load_id uuid,
  _item_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_source_removed boolean;
  v_items uuid[];
  v_audit_id uuid;
begin
  select array_agg(item_id order by item_id)
    into v_items
  from unnest(_item_ids) item(item_id);

  v_result := public.move_load_items_between_loads_capacity_guard_20260917(
    _tenant_id, _source_load_id, _target_load_id, _item_ids
  );

  if not exists (
    select 1 from public.current_load_items
    where load_id = _source_load_id and tenant_id = _tenant_id
  ) then
    perform public.delete_load_if_empty(_source_load_id);
  end if;

  select not exists (
    select 1 from public.loads where id = _source_load_id and tenant_id = _tenant_id
  ) into v_source_removed;

  select audit.id
    into v_audit_id
  from public.entity_audit_log audit
  where audit.tenant_id = _tenant_id
    and audit.entity_type = 'load'
    and audit.entity_id = _source_load_id
    and audit.action = 'move_items_out'
    and audit.source = 'composition_rpc'
    and audit.new_data->'target_load_id' = to_jsonb(_target_load_id)
    and audit.new_data->'item_ids' = to_jsonb(v_items)
  order by audit.created_at desc, audit.id desc
  limit 1
  for update;
  if v_audit_id is null then
    raise exception 'composition_audit_not_found' using errcode = 'P0001';
  end if;

  update public.entity_audit_log
  set new_data = jsonb_set(new_data, '{source_removed}', to_jsonb(v_source_removed), true)
  where id = v_audit_id and tenant_id = _tenant_id;
  if not found then
    raise exception 'composition_audit_changed' using errcode = '40001';
  end if;

  return jsonb_set(v_result, '{source_removed}', to_jsonb(v_source_removed), true);
end;
$function$;

revoke all on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  to authenticated, service_role;

comment on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) is
  'Moves load items atomically and commits the final source cleanup result consistently in both response and audit.';
