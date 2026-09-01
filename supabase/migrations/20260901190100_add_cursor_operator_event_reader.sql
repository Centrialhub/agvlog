-- Cursor reader for the operator occurrence list.
-- Replaces fixed result caps without granting a privileged write surface.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)') is not null then
    raise exception 'Operational-event cursor reader is already installed';
  end if;
  if to_regclass('public.operational_events') is null
    or to_regclass('public.loads') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.clients') is null
    or to_regclass('public.vehicles') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null then
    raise exception 'Operational-event cursor reader dependency is missing';
  end if;
end;
$guard$;

create index if not exists operational_events_tenant_created_cursor_idx
  on public.operational_events(tenant_id, created_at desc, id desc);

create function public.list_operational_events_page_v1(
  _tenant_id uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 500,
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
  v_limit integer := least(greatest(coalesce(_limit, 500), 1), 500);
  v_status text;
  v_type text;
  v_severity text;
  v_vehicle uuid;
  v_driver uuid;
  v_client uuid;
  v_load uuid;
  v_impact_min numeric;
  v_impact_max numeric;
  v_has_impact boolean;
  v_from timestamptz;
  v_to timestamptz;
  v_search text;
  v_responsibility text;
  v_scope text;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_items jsonb;
  v_has_more boolean;
  v_last jsonb;
begin
  if v_actor is null
    or _tenant_id is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'operational_event_list_not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(v_filters) <> 'object'
    or octet_length(v_filters::text) > 8000
    or (v_filters - array[
      'status','type','severity','vehicle_id','driver_id','client_id','load_id',
      'impact_min','impact_max','has_impact','date_from','date_to','search','responsibility'
    ]) <> '{}'::jsonb
    or exists (
      select 1 from jsonb_each(v_filters) item
      where (
        item.key in ('status','type','severity','vehicle_id','driver_id','client_id','load_id','date_from','date_to','search','responsibility')
        and jsonb_typeof(item.value) not in ('string','null')
      ) or (
        item.key in ('impact_min','impact_max')
        and jsonb_typeof(item.value) not in ('number','null')
      ) or (
        item.key = 'has_impact'
        and jsonb_typeof(item.value) not in ('boolean','null')
      )
    ) then
    raise exception 'operational_event_list_invalid_filters' using errcode = '22023';
  end if;

  v_status := coalesce(v_filters->>'status', 'all');
  v_type := nullif(v_filters->>'type', '');
  v_severity := nullif(v_filters->>'severity', '');
  v_vehicle := nullif(v_filters->>'vehicle_id', '')::uuid;
  v_driver := nullif(v_filters->>'driver_id', '')::uuid;
  v_client := nullif(v_filters->>'client_id', '')::uuid;
  v_load := nullif(v_filters->>'load_id', '')::uuid;
  v_impact_min := (v_filters->>'impact_min')::numeric;
  v_impact_max := (v_filters->>'impact_max')::numeric;
  v_has_impact := coalesce((v_filters->>'has_impact')::boolean, false);
  v_from := nullif(v_filters->>'date_from', '')::timestamptz;
  v_to := nullif(v_filters->>'date_to', '')::timestamptz;
  v_search := nullif(lower(btrim(v_filters->>'search')), '');
  v_responsibility := coalesce(nullif(v_filters->>'responsibility', ''), 'all');

  if v_status not in ('all','open','resolved')
    or (v_type is not null and v_type !~ '^[a-z][a-z0-9_]{1,63}$')
    or (v_severity is not null and v_severity not in ('low','medium','high','critical'))
    or v_responsibility not in ('all','deposito','transporte')
    or length(coalesce(v_search, '')) > 200
    or (v_impact_min is not null and v_impact_min < 0)
    or (v_impact_max is not null and v_impact_max < 0)
    or (v_impact_min is not null and v_impact_max is not null and v_impact_min > v_impact_max)
    or (v_from is not null and v_to is not null and v_from > v_to) then
    raise exception 'operational_event_list_invalid_filters' using errcode = '22023';
  end if;

  v_scope := encode(sha256(convert_to(_tenant_id::text || ':' || v_filters::text, 'UTF8')), 'hex');
  if _cursor is not null then
    if jsonb_typeof(_cursor) <> 'object'
      or (_cursor - array['scope','created_at','id']) <> '{}'::jsonb
      or not (_cursor ?& array['scope','created_at','id'])
      or exists(select 1 from jsonb_each(_cursor) item where jsonb_typeof(item.value) <> 'string')
      or _cursor->>'scope' <> v_scope then
      raise exception 'operational_event_list_invalid_cursor' using errcode = '22023';
    end if;
    v_cursor_at := (_cursor->>'created_at')::timestamptz;
    v_cursor_id := (_cursor->>'id')::uuid;
  end if;

  with page_rows as materialized (
    select
      e.*,
      l.load_number as joined_load_number,
      d.id as joined_driver_id,
      d.name as joined_driver_name,
      c.company_name as joined_client_name,
      v.plate as joined_vehicle_plate
    from public.operational_events e
    left join public.loads l
      on l.tenant_id = e.tenant_id and l.id = e.load_id
    left join public.drivers d
      on d.tenant_id = e.tenant_id and d.id = e.driver_id
    left join public.clients c
      on c.tenant_id = e.tenant_id and c.id = e.client_id
    left join public.vehicles v
      on v.tenant_id = e.tenant_id and v.id = e.vehicle_id
    where e.tenant_id = _tenant_id
      and (v_status = 'all'
        or (v_status = 'open' and e.resolved_at is null)
        or (v_status = 'resolved' and e.resolved_at is not null))
      and (v_type is null or e.event_type = v_type)
      and (v_severity is null or e.severity = v_severity)
      and (v_vehicle is null or e.vehicle_id = v_vehicle)
      and (v_driver is null or e.driver_id = v_driver)
      and (v_client is null or e.client_id = v_client)
      and (v_load is null or e.load_id = v_load)
      and (not v_has_impact or coalesce(e.financial_impact, 0) > 0)
      and (v_impact_min is null or coalesce(e.financial_impact, 0) >= v_impact_min)
      and (v_impact_max is null or coalesce(e.financial_impact, 0) <= v_impact_max)
      and (v_from is null or e.created_at >= v_from)
      and (v_to is null or e.created_at <= v_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        e.description, l.load_number, d.name, c.company_name
      ))) > 0)
      and (
        v_responsibility = 'all'
        or (v_responsibility = 'deposito' and e.event_type in (
          'missing_goods','missing_goods_fractional','wrong_quantity','wrong_product','expired_goods','near_expiration'
        ))
        or (v_responsibility = 'transporte' and e.event_type not in (
          'missing_goods','missing_goods_fractional','wrong_quantity','wrong_product','expired_goods','near_expiration'
        ))
      )
      and (v_cursor_at is null or (e.created_at, e.id) < (v_cursor_at, v_cursor_id))
    order by e.created_at desc, e.id desc
    limit v_limit + 1
  ), visible_rows as materialized (
    select * from page_rows order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((
      select jsonb_agg(
        (to_jsonb(row_value)
          - 'joined_load_number'
          - 'joined_driver_id'
          - 'joined_driver_name'
          - 'joined_client_name'
          - 'joined_vehicle_plate')
        || jsonb_build_object(
          'loads', case when row_value.load_id is null then null else jsonb_build_object('load_number', row_value.joined_load_number) end,
          'drivers', case when row_value.driver_id is null then null else jsonb_build_object('id', row_value.joined_driver_id, 'name', row_value.joined_driver_name) end,
          'clients', case when row_value.client_id is null then null else jsonb_build_object('company_name', row_value.joined_client_name) end,
          'vehicles', case when row_value.vehicle_id is null then null else jsonb_build_object('plate', row_value.joined_vehicle_plate) end
        )
        order by row_value.created_at desc, row_value.id desc
      ) from visible_rows row_value
    ), '[]'::jsonb),
    (select count(*) > v_limit from page_rows)
  into v_items, v_has_more;

  if v_has_more then
    v_last := v_items->(jsonb_array_length(v_items) - 1);
  end if;
  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'items', v_items,
    'next_cursor', case when v_has_more then jsonb_build_object(
      'scope', v_scope,
      'created_at', v_last->>'created_at',
      'id', v_last->>'id'
    ) else null end
  );
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'operational_event_list_invalid_filters' using errcode = '22023';
end;
$fn$;

revoke all on function public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)
  to authenticated, service_role;

comment on function public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb) is
  'Operator-only, tenant-scoped stable cursor reader. The cursor is bound to the tenant and exact filter object.';
