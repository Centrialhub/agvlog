create or replace function public.move_load_items_between_loads_capacity_guard_20260917(
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
  v_missing_current_pallets integer;
  v_missing_current_weight integer;
  v_missing_added_pallets integer;
  v_missing_added_weight integer;
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

  perform id from public.loads
    where id in (_source_load_id, _target_load_id) and tenant_id = _tenant_id
    order by id for update nowait;
  get diagnostics v_count = row_count;
  if v_count <> 2 then raise exception 'load_ownership_mismatch' using errcode = '23514'; end if;

  select vehicle.max_pallets, vehicle.max_weight_kg
    into v_max_pallets, v_max_weight_kg
    from public.loads load
    left join public.vehicles vehicle
      on vehicle.id = load.vehicle_id and vehicle.tenant_id = _tenant_id
    where load.id = _target_load_id and load.tenant_id = _tenant_id;

  select
    coalesce(sum(item.pallet_count), 0),
    coalesce(sum(item.weight_kg), 0),
    count(*) filter (where item.pallet_count is null),
    count(*) filter (where item.weight_kg is null)
  into
    v_current_pallets, v_current_weight_kg,
    v_missing_current_pallets, v_missing_current_weight
  from public.current_load_items item
  where item.load_id = _target_load_id and item.tenant_id = _tenant_id;

  select
    coalesce(sum(item.pallet_count), 0),
    coalesce(sum(item.weight_kg), 0),
    count(*) filter (where item.pallet_count is null),
    count(*) filter (where item.weight_kg is null)
  into
    v_added_pallets, v_added_weight_kg,
    v_missing_added_pallets, v_missing_added_weight
  from public.current_load_items item
  where item.id = any(_item_ids)
    and item.load_id = _source_load_id and item.tenant_id = _tenant_id;

  if (coalesce(v_max_pallets, 0) > 0 and v_missing_current_pallets + v_missing_added_pallets > 0)
    or (coalesce(v_max_weight_kg, 0) > 0 and v_missing_current_weight + v_missing_added_weight > 0) then
    raise exception 'target_load_capacity_measure_unknown'
      using errcode = '23514',
        detail = format(
          'missing_current_pallets=%s missing_added_pallets=%s missing_current_weight=%s missing_added_weight=%s',
          v_missing_current_pallets, v_missing_added_pallets,
          v_missing_current_weight, v_missing_added_weight
        ),
        hint = 'Informe paletes e peso de todos os itens antes de validar a capacidade da realocação.';
  end if;

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

revoke all on function public.move_load_items_between_loads_capacity_guard_20260917(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;

comment on function public.move_load_items_between_loads_capacity_guard_20260917(uuid,uuid,uuid,uuid[]) is
  'Internal reallocation guard that rejects incomplete measurements before enforcing target vehicle capacity.';
