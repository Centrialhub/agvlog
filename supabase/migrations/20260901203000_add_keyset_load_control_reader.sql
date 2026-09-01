-- Stable, tenant-scoped reader for the high-volume load-control registry.
-- The cursor is tied to the tenant, exact filters and a creation-time snapshot.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)') is not null then
    raise exception 'Load-control cursor reader is already installed';
  end if;
  if to_regclass('public.loads') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.vehicles') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null then
    raise exception 'Load-control cursor reader dependency is missing';
  end if;
end;
$guard$;

create index if not exists loads_tenant_created_cursor_idx
  on public.loads(tenant_id, created_at desc, id desc);

create function public.list_load_control_page_v2(
  _tenant_id uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 250,
  _cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_filters jsonb := coalesce(_filters, '{}'::jsonb);
  v_limit integer := least(greatest(coalesce(_limit, 250), 1), 250);
  v_load_number text;
  v_payment_status text;
  v_operational_status text;
  v_billing_status text;
  v_load_from date;
  v_load_to date;
  v_expected_from date;
  v_expected_to date;
  v_batch uuid;
  v_scope text;
  v_snapshot_at timestamptz;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_items jsonb;
  v_total bigint;
  v_summary jsonb;
  v_has_more boolean;
  v_last jsonb;
begin
  if v_actor is null
    or _tenant_id is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'load_control_list_not_authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(v_filters) <> 'object'
    or octet_length(v_filters::text) > 4000
    or (v_filters - array[
      'loadNumber','paymentStatus','operationalStatus','billingStatus',
      'loadDateFrom','loadDateTo','expectedPayFrom','expectedPayTo','batchId'
    ]) <> '{}'::jsonb
    or exists (
      select 1
      from jsonb_each(v_filters) item
      where jsonb_typeof(item.value) not in ('string', 'null')
    ) then
    raise exception 'load_control_list_invalid_filters' using errcode = '22023';
  end if;

  begin
    v_load_number := nullif(btrim(v_filters->>'loadNumber'), '');
    v_payment_status := nullif(v_filters->>'paymentStatus', '');
    v_operational_status := nullif(v_filters->>'operationalStatus', '');
    v_billing_status := nullif(v_filters->>'billingStatus', '');
    v_load_from := nullif(v_filters->>'loadDateFrom', '')::date;
    v_load_to := nullif(v_filters->>'loadDateTo', '')::date;
    v_expected_from := nullif(v_filters->>'expectedPayFrom', '')::date;
    v_expected_to := nullif(v_filters->>'expectedPayTo', '')::date;
    v_batch := nullif(v_filters->>'batchId', '')::uuid;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'load_control_list_invalid_filters' using errcode = '22023';
  end;

  if length(coalesce(v_load_number, '')) > 120
    or (v_payment_status is not null and v_payment_status !~ '^[a-z][a-z0-9_]{0,63}$')
    or (v_operational_status is not null and v_operational_status !~ '^[a-z][a-z0-9_]{0,63}$')
    or (v_billing_status is not null and v_billing_status !~ '^[a-z][a-z0-9_]{0,63}$')
    or (v_load_from is not null and v_load_to is not null and v_load_from > v_load_to)
    or (v_expected_from is not null and v_expected_to is not null and v_expected_from > v_expected_to) then
    raise exception 'load_control_list_invalid_filters' using errcode = '22023';
  end if;

  v_scope := encode(sha256(convert_to(_tenant_id::text || ':' || v_filters::text, 'UTF8')), 'hex');
  if _cursor is null then
    v_snapshot_at := statement_timestamp();
  else
    if jsonb_typeof(_cursor) <> 'object'
      or (_cursor - array['scope','snapshot_at','created_at','id']) <> '{}'::jsonb
      or not (_cursor ?& array['scope','snapshot_at','created_at','id'])
      or exists(select 1 from jsonb_each(_cursor) item where jsonb_typeof(item.value) <> 'string')
      or _cursor->>'scope' <> v_scope then
      raise exception 'load_control_list_invalid_cursor' using errcode = '22023';
    end if;
    begin
      v_snapshot_at := (_cursor->>'snapshot_at')::timestamptz;
      v_cursor_at := (_cursor->>'created_at')::timestamptz;
      v_cursor_id := (_cursor->>'id')::uuid;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'load_control_list_invalid_cursor' using errcode = '22023';
    end;
    if v_snapshot_at > statement_timestamp() + interval '5 minutes'
      or v_cursor_at > v_snapshot_at then
      raise exception 'load_control_list_invalid_cursor' using errcode = '22023';
    end if;
  end if;

  with filtered_rows as materialized (
    select
      l.id,
      l.tenant_id,
      l.load_number,
      l.external_load_number,
      l.load_date,
      l.arrival_date,
      l.gross_cargo_value,
      l.freight_amount,
      l.freight_percent,
      l.total_weight_kg,
      l.invoice_count,
      l.cte_count,
      l.operational_status,
      l.billing_status,
      l.payment_status,
      l.expected_payment_date,
      l.payment_date,
      l.received_amount,
      l.legacy_status_text,
      l.receivable_id,
      l.client_invoice_id,
      l.doccob_export_id,
      l.origin,
      l.destination,
      l.status,
      l.created_at,
      coalesce(nullif(l.origin, ''), nullif(l.destination, '')) as client_name,
      d.name as driver_name,
      coalesce(nullif(v.plate, ''), nullif(l.trailer_plate, '')) as plate
    from public.loads l
    left join public.drivers d
      on d.tenant_id = l.tenant_id and d.id = l.driver_id
    left join public.vehicles v
      on v.tenant_id = l.tenant_id and v.id = l.vehicle_id
    where l.tenant_id = _tenant_id
      and l.created_at <= v_snapshot_at
      and (
        v_load_number is null
        or position(lower(v_load_number) in lower(coalesce(l.external_load_number, ''))) > 0
        or position(lower(v_load_number) in lower(l.load_number)) > 0
      )
      and (v_payment_status is null or l.payment_status = v_payment_status)
      and (v_operational_status is null or l.operational_status = v_operational_status)
      and (v_billing_status is null or l.billing_status = v_billing_status)
      and (v_load_from is null or l.load_date >= v_load_from)
      and (v_load_to is null or l.load_date <= v_load_to)
      and (v_expected_from is null or l.expected_payment_date >= v_expected_from)
      and (v_expected_to is null or l.expected_payment_date <= v_expected_to)
      and (v_batch is null or l.last_import_batch_id = v_batch)
  ), page_rows as materialized (
    select *
    from filtered_rows row_value
    where v_cursor_at is null or (row_value.created_at, row_value.id) < (v_cursor_at, v_cursor_id)
    order by row_value.created_at desc, row_value.id desc
    limit v_limit + 1
  ), visible_rows as materialized (
    select * from page_rows order by created_at desc, id desc limit v_limit
  ), summary_values as materialized (
    select
      count(*)::bigint as total_count,
      count(*) filter (where payment_status = 'paid')::bigint as paid_count,
      count(*) filter (where payment_status in ('unpaid', 'partially_paid'))::bigint as unpaid_count,
      count(*) filter (where payment_status = 'overdue')::bigint as overdue_count,
      coalesce(sum(gross_cargo_value), 0) as billed_total,
      coalesce(sum(freight_amount), 0) as freight_total,
      coalesce(sum(greatest(0, freight_amount - received_amount)), 0) as open_total,
      coalesce(sum(total_weight_kg), 0) as weight_total,
      coalesce(sum(invoice_count), 0) as invoice_total,
      coalesce(sum(cte_count), 0) as cte_total
    from filtered_rows
  )
  select
    coalesce((select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc, row_value.id desc)
      from visible_rows row_value), '[]'::jsonb),
    (select total_count from summary_values),
    jsonb_build_object(
      'paid', (select paid_count from summary_values),
      'unpaid', (select unpaid_count from summary_values),
      'overdue', (select overdue_count from summary_values),
      'billed', (select billed_total from summary_values),
      'freight', (select freight_total from summary_values),
      'open', (select open_total from summary_values),
      'weight', (select weight_total from summary_values),
      'nfs', (select invoice_total from summary_values),
      'ctes', (select cte_total from summary_values)
    ),
    (select count(*) > v_limit from page_rows)
  into v_items, v_total, v_summary, v_has_more;

  if v_has_more then
    v_last := v_items->(jsonb_array_length(v_items) - 1);
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'items', v_items,
    'total_count', v_total,
    'summary', v_summary,
    'next_cursor', case when v_has_more then jsonb_build_object(
      'scope', v_scope,
      'snapshot_at', v_snapshot_at,
      'created_at', v_last->>'created_at',
      'id', v_last->>'id'
    ) else null end
  );
end;
$fn$;

revoke all on function public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)
  to authenticated;

comment on function public.list_load_control_page_v2(uuid,jsonb,integer,jsonb) is
  'Operator-only keyset reader for load control. Returns exact snapshot totals and a cursor bound to tenant and filters.';
