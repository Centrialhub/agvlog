-- Stable settlement browsing: freeze the result set, reject inverted dates and
-- advance with the complete deterministic sort key instead of OFFSET.

create or replace function public.list_driver_settlements_v2(
  _tenant_id uuid,
  _search text default null,
  _driver_id uuid default null,
  _vehicle_id uuid default null,
  _status text default null,
  _date_from date default null,
  _date_to date default null,
  _only_km_pending boolean default false,
  _only_expense_pending boolean default false,
  _only_no_freight boolean default false,
  _only_needs_recalculation boolean default false,
  _snapshot_at timestamptz default null,
  _cursor jsonb default null,
  _page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_page_size integer := least(greatest(coalesce(_page_size, 50), 1), 100);
  v_snapshot timestamptz := coalesce(_snapshot_at, statement_timestamp());
  v_q text := nullif(trim(coalesce(_search, '')), '');
  v_scope text;
  v_cursor_trip timestamptz;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_total integer;
  v_items jsonb;
  v_summary jsonb;
  v_next jsonb;
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _date_from is not null and _date_to is not null and _date_from > _date_to then
    raise exception 'settlement_date_range_invalid' using errcode = '22007';
  end if;
  if v_snapshot > statement_timestamp() + interval '1 minute' then
    raise exception 'settlement_snapshot_invalid' using errcode = '22007';
  end if;

  v_scope := md5(jsonb_build_object(
    'tenant_id', _tenant_id,
    'search', v_q,
    'driver_id', _driver_id,
    'vehicle_id', _vehicle_id,
    'status', _status,
    'date_from', _date_from,
    'date_to', _date_to,
    'only_km_pending', coalesce(_only_km_pending, false),
    'only_expense_pending', coalesce(_only_expense_pending, false),
    'only_no_freight', coalesce(_only_no_freight, false),
    'only_needs_recalculation', coalesce(_only_needs_recalculation, false),
    'snapshot_at', v_snapshot
  )::text);

  if _cursor is not null then
    begin
      if _cursor ->> 'scope' is distinct from v_scope then
        raise exception 'settlement_cursor_scope_invalid' using errcode = '22023';
      end if;
      v_cursor_trip := nullif(_cursor ->> 'trip_completed_at', '')::timestamptz;
      v_cursor_created := (_cursor ->> 'created_at')::timestamptz;
      v_cursor_id := (_cursor ->> 'id')::uuid;
      if v_cursor_created is null or v_cursor_id is null then
        raise exception 'settlement_cursor_invalid' using errcode = '22023';
      end if;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'settlement_cursor_invalid' using errcode = '22023';
    end;
  end if;

  with base as materialized (
    select settlement.*, driver.name as driver_name, vehicle.plate as vehicle_plate
    from public.driver_settlements settlement
    left join public.drivers driver
      on driver.id = settlement.driver_id and driver.tenant_id = settlement.tenant_id
    left join public.vehicles vehicle
      on vehicle.id = settlement.vehicle_id and vehicle.tenant_id = settlement.tenant_id
    where settlement.tenant_id = _tenant_id
      and settlement.created_at <= v_snapshot
      and (_status is null or settlement.status = _status)
      and (_driver_id is null or settlement.driver_id = _driver_id)
      and (_vehicle_id is null or settlement.vehicle_id = _vehicle_id)
      and (_date_from is null or settlement.trip_completed_at >= _date_from)
      and (_date_to is null or settlement.trip_completed_at < (_date_to + interval '1 day'))
      and (not coalesce(_only_km_pending, false) or settlement.km_review_status = 'pending')
      and (not coalesce(_only_expense_pending, false) or coalesce(settlement.pending_expenses_total, 0) > 0)
      and (not coalesce(_only_no_freight, false) or coalesce(settlement.total_freight_value, 0) = 0)
      and (not coalesce(_only_needs_recalculation, false) or settlement.needs_recalculation)
      and (
        v_q is null
        or driver.name ilike '%' || v_q || '%'
        or vehicle.plate ilike '%' || v_q || '%'
        or settlement.route_name ilike '%' || v_q || '%'
        or settlement.route_origin ilike '%' || v_q || '%'
        or settlement.route_destination ilike '%' || v_q || '%'
        or exists (
          select 1
          from public.driver_settlement_items item
          where item.settlement_id = settlement.id
            and item.tenant_id = _tenant_id
            and item.description ilike '%' || v_q || '%'
        )
      )
  ), totals as (
    select
      count(*)::integer as total_count,
      count(*) filter (where status = 'pending_review')::integer as pending_count,
      count(*) filter (where status = 'in_review')::integer as in_review_count,
      count(*) filter (where status = 'approved')::integer as approved_count,
      count(*) filter (where status in ('paid', 'closed'))::integer as paid_closed_count,
      count(*) filter (where needs_recalculation)::integer as needs_recalculation_count,
      count(*) filter (where km_review_status = 'pending')::integer as km_pending_count,
      count(*) filter (where coalesce(pending_expenses_total, 0) > 0)::integer as expense_pending_count,
      coalesce(sum(driver_payable_amount), 0) as total_payable,
      coalesce(sum(total_paid_amount), 0) as total_paid,
      coalesce(sum(payment_balance), 0) as payment_balance,
      coalesce(sum(route_result), 0) as route_result_total,
      coalesce(sum(approved_expenses_total), 0) as approved_expenses_total
    from base
  ), candidates as (
    select base.*
    from base
    where _cursor is null
      or (
        v_cursor_trip is not null
        and (
          base.trip_completed_at < v_cursor_trip
          or (
            base.trip_completed_at = v_cursor_trip
            and (base.created_at < v_cursor_created or (base.created_at = v_cursor_created and base.id < v_cursor_id))
          )
          or base.trip_completed_at is null
        )
      )
      or (
        v_cursor_trip is null
        and base.trip_completed_at is null
        and (base.created_at < v_cursor_created or (base.created_at = v_cursor_created and base.id < v_cursor_id))
      )
    order by base.trip_completed_at desc nulls last, base.created_at desc, base.id desc
    limit v_page_size + 1
  ), numbered as (
    select candidates.*,
      row_number() over (order by candidates.trip_completed_at desc nulls last, candidates.created_at desc, candidates.id desc) as page_row
    from candidates
  ), page_rows as (
    select * from numbered where page_row <= v_page_size
  )
  select
    totals.total_count,
    coalesce((
      select jsonb_agg(to_jsonb(page_rows) - 'page_row' order by page_rows.page_row)
      from page_rows
    ), '[]'::jsonb),
    to_jsonb(totals),
    case when (select count(*) from candidates) > v_page_size then (
      select jsonb_build_object(
        'scope', v_scope,
        'trip_completed_at', page_rows.trip_completed_at,
        'created_at', page_rows.created_at,
        'id', page_rows.id
      )
      from page_rows
      order by page_rows.page_row desc
      limit 1
    ) end
  into v_total, v_items, v_summary, v_next
  from totals;

  return jsonb_build_object(
    'version', 2,
    'tenant_id', _tenant_id,
    'snapshot_at', v_snapshot,
    'items', v_items,
    'total_count', coalesce(v_total, 0),
    'page_size', v_page_size,
    'next_cursor', v_next,
    'summary', coalesce(v_summary, '{}'::jsonb)
  );
end;
$function$;

revoke all on function public.list_driver_settlements_v2(
  uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,timestamptz,jsonb,integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_driver_settlements_v2(
  uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,timestamptz,jsonb,integer
) to authenticated, service_role;
