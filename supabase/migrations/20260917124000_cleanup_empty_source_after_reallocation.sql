alter function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  rename to move_load_items_between_loads_capacity_guard_20260917;

revoke all on function public.move_load_items_between_loads_capacity_guard_20260917(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;

create function public.move_load_items_between_loads(
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
begin
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

  return jsonb_set(v_result, '{source_removed}', to_jsonb(v_source_removed), true);
end;
$function$;

revoke all on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  to authenticated, service_role;

comment on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) is
  'Moves load items atomically, enforces target vehicle capacity, and removes an eligible source load that becomes empty.';
