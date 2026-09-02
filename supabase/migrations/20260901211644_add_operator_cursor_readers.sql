-- Complete, bounded reference catalogs for operator screens.
--
-- Direct PostgREST reads silently stop at the project's response cap. This
-- reader keeps the existing RLS policies authoritative, validates the caller's
-- operator role and advances over immutable (created_at, id) keys. The cursor
-- is bound to the tenant, catalog and active/inactive scope.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)') is not null then
    raise exception 'Operator reference cursor reader is already installed';
  end if;
  if to_regprocedure('public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)') is not null then
    raise exception 'Operator client cursor reader is already installed';
  end if;
  if to_regclass('public.loads') is null
    or to_regclass('public.clients') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.vehicles') is null
    or to_regclass('public.operational_routes') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null then
    raise exception 'Operator reference cursor reader dependency is missing';
  end if;
end;
$guard$;

create index if not exists clients_tenant_created_cursor_idx
  on public.clients(tenant_id, created_at desc, id desc);
create index if not exists clients_tenant_name_cursor_idx
  on public.clients(tenant_id, company_name, id);
create index if not exists drivers_tenant_created_cursor_idx
  on public.drivers(tenant_id, created_at desc, id desc);
create index if not exists vehicles_tenant_created_cursor_idx
  on public.vehicles(tenant_id, created_at desc, id desc);
create index if not exists operational_routes_tenant_created_cursor_idx
  on public.operational_routes(tenant_id, created_at desc, id desc);

create function public.list_operator_reference_page_v1(
  _tenant_id uuid,
  _resource text,
  _include_inactive boolean default false,
  _limit integer default 500,
  _cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_resource text := lower(btrim(coalesce(_resource, '')));
  v_include_inactive boolean := coalesce(_include_inactive, false);
  v_limit integer := least(greatest(coalesce(_limit, 500), 1), 500);
  v_scope text;
  v_snapshot_at timestamptz;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_items jsonb;
  v_has_more boolean;
  v_last jsonb;
begin
  if v_actor is null
    or _tenant_id is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'operator_reference_list_not_authorized' using errcode = '42501';
  end if;

  if v_resource not in ('loads', 'clients', 'drivers', 'vehicles', 'operational_routes') then
    raise exception 'operator_reference_list_invalid_resource' using errcode = '22023';
  end if;

  v_scope := encode(sha256(convert_to(
    _tenant_id::text || ':' || v_resource || ':' || v_include_inactive::text,
    'UTF8'
  )), 'hex');

  if _cursor is null then
    v_snapshot_at := statement_timestamp();
  else
    if jsonb_typeof(_cursor) <> 'object'
      or (_cursor - array['scope','snapshot_at','created_at','id']) <> '{}'::jsonb
      or not (_cursor ?& array['scope','snapshot_at','created_at','id'])
      or exists (
        select 1 from jsonb_each(_cursor) item
        where jsonb_typeof(item.value) <> 'string'
      )
      or _cursor->>'scope' <> v_scope then
      raise exception 'operator_reference_list_invalid_cursor' using errcode = '22023';
    end if;
    begin
      v_snapshot_at := (_cursor->>'snapshot_at')::timestamptz;
      v_cursor_at := (_cursor->>'created_at')::timestamptz;
      v_cursor_id := (_cursor->>'id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'operator_reference_list_invalid_cursor' using errcode = '22023';
    end;
    if v_snapshot_at > statement_timestamp() + interval '5 minutes'
      or v_cursor_at > v_snapshot_at then
      raise exception 'operator_reference_list_invalid_cursor' using errcode = '22023';
    end if;
  end if;

  if v_resource = 'loads' then
    with page_rows as materialized (
      select
        to_jsonb(load_row)
          || jsonb_build_object(
            'vehicles', case when vehicle_row.id is null then null else jsonb_build_object(
              'plate', vehicle_row.plate,
              'nickname', vehicle_row.nickname
            ) end,
            'drivers', case when driver_row.id is null then null else jsonb_build_object(
              'name', driver_row.name
            ) end
          ) as item,
        load_row.created_at,
        load_row.id
      from public.loads load_row
      left join public.vehicles vehicle_row
        on vehicle_row.tenant_id = load_row.tenant_id
        and vehicle_row.id = load_row.vehicle_id
      left join public.drivers driver_row
        on driver_row.tenant_id = load_row.tenant_id
        and driver_row.id = load_row.driver_id
      where load_row.tenant_id = _tenant_id
        and load_row.created_at <= v_snapshot_at
        and (v_cursor_at is null or (load_row.created_at, load_row.id) < (v_cursor_at, v_cursor_id))
      order by load_row.created_at desc, load_row.id desc
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by created_at desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible_rows), '[]'::jsonb),
      (select count(*) > v_limit from page_rows)
    into v_items, v_has_more;
  elsif v_resource = 'clients' then
    with page_rows as materialized (
      select to_jsonb(client_row) as item, client_row.created_at, client_row.id
      from public.clients client_row
      where client_row.tenant_id = _tenant_id
        and (v_include_inactive or client_row.active)
        and client_row.created_at <= v_snapshot_at
        and (v_cursor_at is null or (client_row.created_at, client_row.id) < (v_cursor_at, v_cursor_id))
      order by client_row.created_at desc, client_row.id desc
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by created_at desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible_rows), '[]'::jsonb),
      (select count(*) > v_limit from page_rows)
    into v_items, v_has_more;
  elsif v_resource = 'drivers' then
    with page_rows as materialized (
      select
        to_jsonb(driver_row)
          || jsonb_build_object(
            'current_vehicle', case when vehicle_row.id is null then null else jsonb_build_object(
              'id', vehicle_row.id,
              'plate', vehicle_row.plate,
              'nickname', vehicle_row.nickname
            ) end
          ) as item,
        driver_row.created_at,
        driver_row.id
      from public.drivers driver_row
      left join public.vehicles vehicle_row
        on vehicle_row.tenant_id = driver_row.tenant_id
        and vehicle_row.id = driver_row.current_vehicle_id
      where driver_row.tenant_id = _tenant_id
        and (v_include_inactive or driver_row.active)
        and driver_row.created_at <= v_snapshot_at
        and (v_cursor_at is null or (driver_row.created_at, driver_row.id) < (v_cursor_at, v_cursor_id))
      order by driver_row.created_at desc, driver_row.id desc
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by created_at desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible_rows), '[]'::jsonb),
      (select count(*) > v_limit from page_rows)
    into v_items, v_has_more;
  elsif v_resource = 'vehicles' then
    with page_rows as materialized (
      select
        to_jsonb(safe_vehicle)
          || jsonb_build_object(
            'current_driver', case when driver_row.id is null then null else jsonb_build_object(
              'id', driver_row.id,
              'name', driver_row.name
            ) end
          ) as item,
        safe_vehicle.created_at,
        safe_vehicle.id
      from (
        select
          vehicle_row.id,
          vehicle_row.tenant_id,
          vehicle_row.plate,
          vehicle_row.nickname,
          vehicle_row.type,
          vehicle_row.active,
          vehicle_row.tags,
          vehicle_row.created_at,
          vehicle_row.updated_at,
          vehicle_row.created_by,
          vehicle_row.updated_by,
          vehicle_row.tank_capacity_liters,
          vehicle_row.speed_limit_kmh,
          vehicle_row.fuel_canonical_key,
          vehicle_row.max_pallets,
          vehicle_row.max_weight_kg,
          vehicle_row.max_volume_m3,
          vehicle_row.body_type,
          vehicle_row.base_consumption_estimate,
          vehicle_row.loaded_consumption_factor,
          vehicle_row.expected_speed_penalty_loaded,
          vehicle_row.current_driver_id,
          vehicle_row.blocked,
          vehicle_row.in_maintenance,
          vehicle_row.odometer_km,
          vehicle_row.model,
          vehicle_row.year_of_manufacture,
          vehicle_row.brand,
          vehicle_row.capacity_ton,
          vehicle_row.chassis,
          vehicle_row.color,
          vehicle_row.renavam,
          vehicle_row.result_center,
          vehicle_row.result_area,
          vehicle_row.business_unit,
          vehicle_row.vehicle_type_code,
          vehicle_row.body_type_code,
          vehicle_row.category,
          vehicle_row.fleet_type_code,
          vehicle_row.axle_structure,
          vehicle_row.situation_code,
          vehicle_row.avg_km_per_liter,
          vehicle_row.city,
          vehicle_row.uf,
          vehicle_row.owner_name,
          vehicle_row.owner_neighborhood,
          vehicle_row.owner_mobile,
          vehicle_row.owner_phone,
          vehicle_row.owner_notes,
          vehicle_row.tracker_name,
          vehicle_row.tracker_login,
          vehicle_row.plate_raw
        from public.vehicles vehicle_row
        where vehicle_row.tenant_id = _tenant_id
          and (v_include_inactive or vehicle_row.active)
          and vehicle_row.created_at <= v_snapshot_at
          and (v_cursor_at is null or (vehicle_row.created_at, vehicle_row.id) < (v_cursor_at, v_cursor_id))
        order by vehicle_row.created_at desc, vehicle_row.id desc
        limit v_limit + 1
      ) safe_vehicle
      left join public.drivers driver_row
        on driver_row.tenant_id = safe_vehicle.tenant_id
        and driver_row.id = safe_vehicle.current_driver_id
    ), visible_rows as materialized (
      select * from page_rows order by created_at desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible_rows), '[]'::jsonb),
      (select count(*) > v_limit from page_rows)
    into v_items, v_has_more;
  else
    with page_rows as materialized (
      select to_jsonb(route_row) as item, route_row.created_at, route_row.id
      from public.operational_routes route_row
      where route_row.tenant_id = _tenant_id
        and (v_include_inactive or coalesce(route_row.active, false))
        and route_row.created_at <= v_snapshot_at
        and (v_cursor_at is null or (route_row.created_at, route_row.id) < (v_cursor_at, v_cursor_id))
      order by route_row.created_at desc, route_row.id desc
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by created_at desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible_rows), '[]'::jsonb),
      (select count(*) > v_limit from page_rows)
    into v_items, v_has_more;
  end if;

  if v_has_more then
    v_last := v_items->(jsonb_array_length(v_items) - 1);
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'resource', v_resource,
    'items', v_items,
    'next_cursor', case when v_has_more then jsonb_build_object(
      'scope', v_scope,
      'snapshot_at', v_snapshot_at,
      'created_at', v_last->>'created_at',
      'id', v_last->>'id'
    ) else null end
  );
end;
$function$;

revoke all on function public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)
  to authenticated;

comment on function public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb) is
  'Operator-only, RLS-scoped keyset reader for complete load and reference catalogs. Excludes vehicle tracker passwords.';

create function public.list_operator_clients_page_v1(
  _tenant_id uuid,
  _search text default '',
  _kind text default 'all',
  _limit integer default 50,
  _cursor jsonb default null,
  _direction text default 'next',
  _snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_search text := btrim(coalesce(_search, ''));
  v_kind text := lower(btrim(coalesce(_kind, 'all')));
  v_limit integer := least(greatest(coalesce(_limit, 50), 1), 200);
  v_direction text := lower(btrim(coalesce(_direction, 'next')));
  v_scope text;
  v_snapshot_at timestamptz;
  v_cursor_name text;
  v_cursor_id uuid;
  v_items jsonb;
  v_total_count bigint;
  v_has_more boolean;
  v_last_page_size integer;
  v_first jsonb;
  v_last jsonb;
begin
  if v_actor is null
    or _tenant_id is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'operator_clients_list_not_authorized' using errcode = '42501';
  end if;

  if v_kind not in ('all', 'client', 'supplier', 'both')
    or v_direction not in ('next', 'previous') then
    raise exception 'operator_clients_list_invalid_filter' using errcode = '22023';
  end if;

  v_scope := encode(sha256(convert_to(
    _tenant_id::text || ':' || v_search || ':' || v_kind || ':' || v_limit::text,
    'UTF8'
  )), 'hex');

  if _cursor is null then
    v_snapshot_at := coalesce(_snapshot_at, statement_timestamp());
  else
    if jsonb_typeof(_cursor) <> 'object'
      or (_cursor - array['scope','snapshot_at','company_name','id']) <> '{}'::jsonb
      or not (_cursor ?& array['scope','snapshot_at','company_name','id'])
      or exists (
        select 1 from jsonb_each(_cursor) item
        where jsonb_typeof(item.value) <> 'string'
      )
      or _cursor->>'scope' <> v_scope then
      raise exception 'operator_clients_list_invalid_cursor' using errcode = '22023';
    end if;
    begin
      v_snapshot_at := (_cursor->>'snapshot_at')::timestamptz;
      v_cursor_name := _cursor->>'company_name';
      v_cursor_id := (_cursor->>'id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'operator_clients_list_invalid_cursor' using errcode = '22023';
    end;
  end if;

  if v_snapshot_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'operator_clients_list_invalid_cursor' using errcode = '22023';
  end if;

  if v_direction = 'next' then
    with filtered_clients as materialized (
      select client_row.*
      from public.clients client_row
      where client_row.tenant_id = _tenant_id
        and client_row.created_at <= v_snapshot_at
        and (
          v_search = ''
          or client_row.company_name ilike '%' || v_search || '%'
          or coalesce(client_row.legal_name, '') ilike '%' || v_search || '%'
          or coalesce(client_row.trade_name, '') ilike '%' || v_search || '%'
          or coalesce(client_row.tax_id, '') ilike '%' || v_search || '%'
          or coalesce(client_row.internal_code, '') ilike '%' || v_search || '%'
          or coalesce(client_row.sigla, '') ilike '%' || v_search || '%'
          or coalesce(client_row.payer_group, '') ilike '%' || v_search || '%'
          or coalesce(client_row.address_city, '') ilike '%' || v_search || '%'
        )
        and (
          v_kind = 'all'
          or (v_kind = 'client' and coalesce(client_row.is_client, true) and not coalesce(client_row.is_supplier, false))
          or (v_kind = 'supplier' and coalesce(client_row.is_supplier, false) and not coalesce(client_row.is_client, false))
          or (v_kind = 'both' and coalesce(client_row.is_client, false) and coalesce(client_row.is_supplier, false))
        )
    ), page_rows as materialized (
      select to_jsonb(client_row) item, client_row.company_name, client_row.id
      from filtered_clients client_row
      where v_cursor_name is null or (client_row.company_name, client_row.id) > (v_cursor_name, v_cursor_id)
      order by client_row.company_name, client_row.id
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by company_name, id limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by company_name, id) from visible_rows), '[]'::jsonb),
      (select count(*)::bigint from filtered_clients),
      (select count(*) > v_limit from page_rows)
    into v_items, v_total_count, v_has_more;
  else
    with filtered_clients as materialized (
      select client_row.*
      from public.clients client_row
      where client_row.tenant_id = _tenant_id
        and client_row.created_at <= v_snapshot_at
        and (
          v_search = ''
          or client_row.company_name ilike '%' || v_search || '%'
          or coalesce(client_row.legal_name, '') ilike '%' || v_search || '%'
          or coalesce(client_row.trade_name, '') ilike '%' || v_search || '%'
          or coalesce(client_row.tax_id, '') ilike '%' || v_search || '%'
          or coalesce(client_row.internal_code, '') ilike '%' || v_search || '%'
          or coalesce(client_row.sigla, '') ilike '%' || v_search || '%'
          or coalesce(client_row.payer_group, '') ilike '%' || v_search || '%'
          or coalesce(client_row.address_city, '') ilike '%' || v_search || '%'
        )
        and (
          v_kind = 'all'
          or (v_kind = 'client' and coalesce(client_row.is_client, true) and not coalesce(client_row.is_supplier, false))
          or (v_kind = 'supplier' and coalesce(client_row.is_supplier, false) and not coalesce(client_row.is_client, false))
          or (v_kind = 'both' and coalesce(client_row.is_client, false) and coalesce(client_row.is_supplier, false))
        )
    ), page_rows as materialized (
      select to_jsonb(client_row) item, client_row.company_name, client_row.id
      from filtered_clients client_row
      where v_cursor_name is null or (client_row.company_name, client_row.id) < (v_cursor_name, v_cursor_id)
      order by client_row.company_name desc, client_row.id desc
      limit v_limit + 1
    ), visible_rows as materialized (
      select * from page_rows order by company_name desc, id desc limit v_limit
    )
    select
      coalesce((select jsonb_agg(item order by company_name, id) from visible_rows), '[]'::jsonb),
      (select count(*)::bigint from filtered_clients),
      (select count(*) > v_limit from page_rows)
    into v_items, v_total_count, v_has_more;
  end if;

  if v_direction = 'previous' and _cursor is null and v_total_count > 0 then
    v_last_page_size := (v_total_count % v_limit)::integer;
    if v_last_page_size = 0 then v_last_page_size := v_limit; end if;
    if jsonb_array_length(v_items) > v_last_page_size then
      select coalesce(jsonb_agg(element.value order by element.ordinality), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(v_items) with ordinality element(value, ordinality)
      where element.ordinality > jsonb_array_length(v_items) - v_last_page_size;
    end if;
    v_has_more := v_total_count > v_last_page_size;
  end if;

  if jsonb_array_length(v_items) > 0 then
    v_first := v_items->0;
    v_last := v_items->(jsonb_array_length(v_items) - 1);
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'resource', 'clients',
    'snapshot_at', v_snapshot_at,
    'items', v_items,
    'total_count', v_total_count,
    'previous_cursor', case
      when v_first is null then null
      when v_direction = 'previous' and v_has_more then jsonb_build_object(
        'scope', v_scope, 'snapshot_at', v_snapshot_at,
        'company_name', v_first->>'company_name', 'id', v_first->>'id'
      )
      when v_direction = 'next' and _cursor is not null then jsonb_build_object(
        'scope', v_scope, 'snapshot_at', v_snapshot_at,
        'company_name', v_first->>'company_name', 'id', v_first->>'id'
      )
      else null
    end,
    'next_cursor', case
      when v_last is null then null
      when v_direction = 'next' and v_has_more then jsonb_build_object(
        'scope', v_scope, 'snapshot_at', v_snapshot_at,
        'company_name', v_last->>'company_name', 'id', v_last->>'id'
      )
      when v_direction = 'previous' and _cursor is not null then jsonb_build_object(
        'scope', v_scope, 'snapshot_at', v_snapshot_at,
        'company_name', v_last->>'company_name', 'id', v_last->>'id'
      )
      else null
    end
  );
end;
$function$;

revoke all on function public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)
  to authenticated;

comment on function public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz) is
  'Operator-only, RLS-scoped bidirectional keyset reader for the client registry.';

-- These legacy SECURITY DEFINER readers trust a caller-supplied tenant UUID.
-- No browser code uses them; keep only an already-explicit backend service
-- grant until any remaining service consumers are migrated. Guards make the
-- hardening portable to installations that retired a legacy overload earlier.
do $legacy_acl$
begin
  if to_regprocedure('public.list_loads_v1(uuid,text,text[],timestamptz,integer)') is not null then
    execute $sql$revoke execute on function public.list_loads_v1(uuid,text,text[],timestamptz,integer) from public, anon, authenticated$sql$;
  end if;
  if to_regprocedure('public.list_clients_v1(uuid,text,text,integer)') is not null then
    execute $sql$revoke execute on function public.list_clients_v1(uuid,text,text,integer) from public, anon, authenticated$sql$;
  end if;
  if to_regprocedure('public.list_drivers_v1(uuid,text,text,integer)') is not null then
    execute $sql$revoke execute on function public.list_drivers_v1(uuid,text,text,integer) from public, anon, authenticated$sql$;
  end if;
  if to_regprocedure('public.list_operational_routes_v1(uuid,text,text,integer)') is not null then
    execute $sql$revoke execute on function public.list_operational_routes_v1(uuid,text,text,integer) from public, anon, authenticated$sql$;
  end if;
  if to_regprocedure('public.list_fiscal_documents_v1(uuid,text,text[],timestamptz,integer)') is not null then
    execute $sql$revoke execute on function public.list_fiscal_documents_v1(uuid,text,text[],timestamptz,integer) from public, anon, authenticated$sql$;
  end if;
  if to_regprocedure('public.get_next_load_number_v1(uuid)') is not null then
    execute $sql$revoke execute on function public.get_next_load_number_v1(uuid) from public, anon, authenticated$sql$;
  end if;
end;
$legacy_acl$;
