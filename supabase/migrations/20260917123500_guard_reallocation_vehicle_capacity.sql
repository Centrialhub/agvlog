alter function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  rename to move_load_items_between_loads_unguarded_20260917;

revoke all on function public.move_load_items_between_loads_unguarded_20260917(uuid,uuid,uuid,uuid[])
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
  v_actor uuid := auth.uid();
  v_count integer;
  v_max_pallets numeric;
  v_max_weight_kg numeric;
  v_current_pallets numeric;
  v_current_weight_kg numeric;
  v_added_pallets numeric;
  v_added_weight_kg numeric;
begin
  if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _source_load_id is null or _target_load_id is null or _source_load_id = _target_load_id
    or coalesce(cardinality(_item_ids), 0) = 0
    or cardinality(_item_ids) <> (select count(distinct id) from unnest(_item_ids) ids(id)) then
    raise exception 'invalid_composition_request' using errcode = '22023';
  end if;

  perform tenant_id from public.tenant_memberships
    where tenant_id = _tenant_id and user_id = v_actor and active
      and role::text in ('owner', 'admin', 'operator')
    for share nowait;
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;

  -- Same deterministic parent lock used by the underlying composition command.
  perform id from public.loads
    where id in (_source_load_id, _target_load_id) and tenant_id = _tenant_id
    order by id for update nowait;
  get diagnostics v_count = row_count;
  if v_count <> 2 then raise exception 'load_ownership_mismatch' using errcode = '23514'; end if;

  select v.max_pallets, v.max_weight_kg
    into v_max_pallets, v_max_weight_kg
    from public.loads l
    left join public.vehicles v on v.id = l.vehicle_id and v.tenant_id = _tenant_id
    where l.id = _target_load_id and l.tenant_id = _tenant_id;

  select coalesce(sum(i.pallet_count), 0), coalesce(sum(i.weight_kg), 0)
    into v_current_pallets, v_current_weight_kg
    from public.current_load_items i
    where i.load_id = _target_load_id and i.tenant_id = _tenant_id;

  select coalesce(sum(i.pallet_count), 0), coalesce(sum(i.weight_kg), 0)
    into v_added_pallets, v_added_weight_kg
    from public.current_load_items i
    where i.id = any(_item_ids) and i.load_id = _source_load_id and i.tenant_id = _tenant_id;

  if (coalesce(v_max_pallets, 0) > 0 and v_current_pallets + v_added_pallets > v_max_pallets)
    or (coalesce(v_max_weight_kg, 0) > 0 and v_current_weight_kg + v_added_weight_kg > v_max_weight_kg) then
    raise exception 'target_load_capacity_exceeded'
      using errcode = '23514',
        detail = format(
          'projected_pallets=%s max_pallets=%s projected_weight_kg=%s max_weight_kg=%s',
          v_current_pallets + v_added_pallets, v_max_pallets,
          v_current_weight_kg + v_added_weight_kg, v_max_weight_kg
        ),
        hint = 'Escolha outra carga ou outro veículo antes de realocar os itens.';
  end if;

  return public.move_load_items_between_loads_unguarded_20260917(
    _tenant_id, _source_load_id, _target_load_id, _item_ids
  );
exception when lock_not_available then
  raise exception 'composition_concurrent_change'
    using errcode = '40001', hint = 'Atualize as cargas antes de confirmar novamente.';
end;
$function$;

revoke all on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])
  to authenticated, service_role;

comment on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) is
  'Moves load items atomically and refuses a target composition above the assigned vehicle pallet or weight capacity.';
