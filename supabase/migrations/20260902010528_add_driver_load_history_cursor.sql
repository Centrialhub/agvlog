-- Complete, bounded load history for the authenticated driver.
--
-- The driver screen used to rely on one unbounded PostgREST request, which can
-- silently stop at the project's Data API row cap. This SECURITY INVOKER reader
-- keeps RLS authoritative and advances over the immutable (created_at, id) key.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)') is not null then
    raise exception 'Driver load history cursor reader is already installed';
  end if;
  if to_regclass('public.loads') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.vehicles') is null
    or to_regclass('public.dispatch_trips') is null
    or to_regclass('public.dispatch_trip_loads') is null
    or to_regclass('public.tenant_memberships') is null
    or to_regprocedure('public.current_driver_id(uuid)') is null then
    raise exception 'Driver load history cursor dependency is missing';
  end if;
end;
$guard$;

create function public.list_driver_loads_page_v1(
  _tenant_id uuid,
  _search text default null,
  _status text default null,
  _limit integer default 50,
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
  v_driver uuid;
  v_search text := nullif(btrim(coalesce(_search, '')), '');
  v_status text := nullif(lower(btrim(coalesce(_status, ''))), '');
  v_limit integer := least(greatest(coalesce(_limit, 50), 1), 50);
  v_scope text;
  v_snapshot_at timestamptz;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_pattern text;
  v_items jsonb;
  v_has_more boolean;
  v_last jsonb;
begin
  if v_actor is null or _tenant_id is null then
    raise exception 'driver_load_list_not_authorized' using errcode = '42501';
  end if;

  v_driver := public.current_driver_id(_tenant_id);
  if v_driver is null or not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = _tenant_id
      and membership.user_id = v_actor
      and membership.active = true
  ) then
    raise exception 'driver_load_list_not_authorized' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in (
    'planned', 'assembling', 'ready', 'loading', 'loaded', 'in_transit',
    'partial_delivery', 'returned', 'refused', 'failed', 'cancelled',
    'delivered', 'divergent'
  ) then
    raise exception 'driver_load_list_invalid_status' using errcode = '22023';
  end if;

  if v_search is not null then
    v_pattern := '%' || replace(
      replace(replace(v_search, E'\\', E'\\\\'), '%', E'\\%'),
      '_', E'\\_'
    ) || '%';
  end if;

  v_scope := encode(sha256(convert_to(
    _tenant_id::text || ':' || v_actor::text || ':' || v_driver::text || ':'
      || coalesce(lower(v_search), '') || ':' || coalesce(v_status, ''),
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
      raise exception 'driver_load_list_invalid_cursor' using errcode = '22023';
    end if;
    begin
      v_snapshot_at := (_cursor->>'snapshot_at')::timestamptz;
      v_cursor_at := (_cursor->>'created_at')::timestamptz;
      v_cursor_id := (_cursor->>'id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'driver_load_list_invalid_cursor' using errcode = '22023';
    end;
    if v_snapshot_at > statement_timestamp() + interval '5 minutes'
      or v_cursor_at > v_snapshot_at then
      raise exception 'driver_load_list_invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with page_rows as materialized (
    select
      jsonb_build_object(
        'id', load_row.id,
        'tenant_id', load_row.tenant_id,
        'load_number', load_row.load_number,
        'origin', load_row.origin,
        'destination', load_row.destination,
        'status', load_row.status,
        'scheduled_load_at', load_row.scheduled_load_at,
        'total_pallet_count', load_row.total_pallet_count,
        'total_weight_kg', load_row.total_weight_kg,
        'created_at', load_row.created_at,
        'vehicles', case when vehicle_row.id is null then null else jsonb_build_object(
          'plate', vehicle_row.plate,
          'nickname', vehicle_row.nickname
        ) end,
        'dispatch_trip_loads', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'dispatch_trip_id', trip_link.dispatch_trip_id,
              'dispatch_trips', jsonb_build_object(
                'status', trip_link.status,
                'actual_start_at', trip_link.actual_start_at
              )
            )
            order by trip_link.created_at desc, trip_link.dispatch_trip_id desc
          )
          from (
            select
              linked_trip.id as dispatch_trip_id,
              linked_trip.status,
              linked_trip.actual_start_at,
              link.created_at
            from public.dispatch_trip_loads link
            join public.dispatch_trips linked_trip
              on linked_trip.id = link.dispatch_trip_id
             and linked_trip.tenant_id = _tenant_id
             and linked_trip.driver_id = v_driver
            where link.tenant_id = _tenant_id
              and link.load_id = load_row.id

            union all

            select
              legacy_trip.id,
              legacy_trip.status,
              legacy_trip.actual_start_at,
              legacy_trip.created_at
            from public.dispatch_trips legacy_trip
            where legacy_trip.id = load_row.trip_id
              and legacy_trip.tenant_id = _tenant_id
              and legacy_trip.driver_id = v_driver
              and not exists (
                select 1
                from public.dispatch_trip_loads existing_link
                where existing_link.tenant_id = _tenant_id
                  and existing_link.load_id = load_row.id
                  and existing_link.dispatch_trip_id = legacy_trip.id
              )
          ) trip_link
        ), '[]'::jsonb)
      ) as item,
      load_row.created_at,
      load_row.id
    from public.loads load_row
    left join public.vehicles vehicle_row
      on vehicle_row.id = load_row.vehicle_id
     and vehicle_row.tenant_id = _tenant_id
    where load_row.tenant_id = _tenant_id
      and load_row.on_hold = false
      and (load_row.driver_id is null or load_row.driver_id = v_driver)
      and (
        load_row.driver_id = v_driver
        or exists (
          select 1
          from public.dispatch_trip_loads ownership_link
          join public.dispatch_trips ownership_trip
            on ownership_trip.id = ownership_link.dispatch_trip_id
           and ownership_trip.tenant_id = _tenant_id
           and ownership_trip.driver_id = v_driver
          where ownership_link.tenant_id = _tenant_id
            and ownership_link.load_id = load_row.id
        )
        or exists (
          select 1
          from public.dispatch_trips ownership_trip
          where ownership_trip.id = load_row.trip_id
            and ownership_trip.tenant_id = _tenant_id
            and ownership_trip.driver_id = v_driver
        )
      )
      and (
        load_row.trip_id is null
        or exists (
          select 1
          from public.dispatch_trips canonical_trip
          where canonical_trip.id = load_row.trip_id
            and canonical_trip.tenant_id = _tenant_id
            and canonical_trip.driver_id = v_driver
        )
      )
      and (v_status is null or load_row.status = v_status)
      and (
        v_pattern is null
        or coalesce(load_row.load_number, '') ilike v_pattern escape E'\\'
        or coalesce(load_row.origin, '') ilike v_pattern escape E'\\'
        or coalesce(load_row.destination, '') ilike v_pattern escape E'\\'
        or coalesce(vehicle_row.plate, '') ilike v_pattern escape E'\\'
        or coalesce(vehicle_row.nickname, '') ilike v_pattern escape E'\\'
      )
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

  if v_has_more then
    v_last := v_items->(jsonb_array_length(v_items) - 1);
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'driver_id', v_driver,
    'search', v_search,
    'status', v_status,
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

revoke all on function public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)
  to authenticated;

comment on function public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb) is
  'Driver-only, RLS-preserving keyset reader for complete non-held assigned load history.';
