-- Complete, bounded operational-event history for the authenticated driver.
--
-- The two driver screens previously stopped after 20/100 rows. This reader
-- keeps RLS authoritative, includes trip/stop-owned events without an explicit
-- driver, and advances over a stable (created_at, id) snapshot.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)') is not null then
    raise exception 'Driver operational-event cursor reader is already installed';
  end if;
  if to_regclass('public.operational_events') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.dispatch_trips') is null
    or to_regclass('public.dispatch_stops') is null
    or to_regclass('public.tenant_memberships') is null
    or to_regprocedure('public.current_driver_id(uuid)') is null then
    raise exception 'Driver operational-event cursor dependency is missing';
  end if;
end;
$guard$;

create index if not exists operational_events_tenant_created_cursor_idx
  on public.operational_events(tenant_id, created_at desc, id desc);

create function public.list_driver_operational_events_page_v1(
  _tenant_id uuid,
  _trip_id uuid default null,
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
  v_limit integer := least(greatest(coalesce(_limit, 50), 1), 50);
  v_scope text;
  v_snapshot_at timestamptz;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_items jsonb;
  v_has_more boolean;
  v_last jsonb;
begin
  if v_actor is null or _tenant_id is null then
    raise exception 'driver_event_list_not_authorized' using errcode = '42501';
  end if;

  v_driver := public.current_driver_id(_tenant_id);
  if v_driver is null or not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = _tenant_id
      and membership.user_id = v_actor
      and membership.active = true
      and membership.role::text = 'driver'
  ) then
    raise exception 'driver_event_list_not_authorized' using errcode = '42501';
  end if;

  if _trip_id is not null and not exists (
    select 1
    from public.dispatch_trips trip_row
    where trip_row.tenant_id = _tenant_id
      and trip_row.id = _trip_id
      and trip_row.driver_id = v_driver
  ) then
    raise exception 'driver_event_list_not_authorized' using errcode = '42501';
  end if;

  v_scope := encode(sha256(convert_to(
    _tenant_id::text || ':' || v_actor::text || ':' || v_driver::text || ':' || coalesce(_trip_id::text, ''),
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
      raise exception 'driver_event_list_invalid_cursor' using errcode = '22023';
    end if;
    begin
      v_snapshot_at := (_cursor->>'snapshot_at')::timestamptz;
      v_cursor_at := (_cursor->>'created_at')::timestamptz;
      v_cursor_id := (_cursor->>'id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'driver_event_list_invalid_cursor' using errcode = '22023';
    end;
    if v_snapshot_at > statement_timestamp() + interval '5 minutes'
      or v_cursor_at > v_snapshot_at then
      raise exception 'driver_event_list_invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with page_rows as materialized (
    select
      jsonb_build_object(
        'id', event_row.id,
        'tenant_id', event_row.tenant_id,
        'driver_id', event_row.driver_id,
        'dispatch_trip_id', event_row.dispatch_trip_id,
        'dispatch_stop_id', event_row.dispatch_stop_id,
        'event_type', event_row.event_type,
        'severity', event_row.severity,
        'description', event_row.description,
        'report_details', event_row.report_details,
        'payload', event_row.payload,
        'created_at', event_row.created_at
      ) as item,
      event_row.created_at,
      event_row.id
    from public.operational_events event_row
    where event_row.tenant_id = _tenant_id
      and (
        event_row.driver_id = v_driver
        or (
          event_row.driver_id is null
          and event_row.dispatch_trip_id is not null
          and exists (
            select 1
            from public.dispatch_trips owned_trip
            where owned_trip.tenant_id = _tenant_id
              and owned_trip.id = event_row.dispatch_trip_id
              and owned_trip.driver_id = v_driver
          )
        )
        or (
          event_row.driver_id is null
          and event_row.dispatch_trip_id is null
          and event_row.dispatch_stop_id is not null
          and exists (
            select 1
            from public.dispatch_stops owned_stop
            join public.dispatch_trips owned_trip
              on owned_trip.tenant_id = owned_stop.tenant_id
             and owned_trip.id = owned_stop.dispatch_trip_id
             and owned_trip.driver_id = v_driver
            where owned_stop.tenant_id = _tenant_id
              and owned_stop.id = event_row.dispatch_stop_id
          )
        )
      )
      and (
        _trip_id is null
        or event_row.dispatch_trip_id = _trip_id
        or (
          event_row.dispatch_trip_id is null
          and exists (
            select 1
            from public.dispatch_stops scoped_stop
            where scoped_stop.tenant_id = _tenant_id
              and scoped_stop.id = event_row.dispatch_stop_id
              and scoped_stop.dispatch_trip_id = _trip_id
          )
        )
      )
      and event_row.created_at <= v_snapshot_at
      and (v_cursor_at is null or (event_row.created_at, event_row.id) < (v_cursor_at, v_cursor_id))
    order by event_row.created_at desc, event_row.id desc
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
    'trip_id', _trip_id,
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

revoke all on function public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)
  to authenticated;

comment on function public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb) is
  'Driver-only, RLS-preserving keyset reader for complete operational-event history.';
