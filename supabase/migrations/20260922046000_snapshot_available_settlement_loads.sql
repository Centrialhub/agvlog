drop function if exists public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer);

create function public.list_available_loads_for_settlement_v2(
  _tenant_id uuid,
  _driver_id uuid default null,
  _search text default null,
  _include_settlement_id uuid default null,
  _page integer default 1,
  _page_size integer default 100,
  _expected_revision text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_page integer := greatest(coalesce(_page,1),1);
  v_size integer := greatest(1,least(coalesce(_page_size,100),200));
  v_total bigint;
  v_revision text;
  v_rows jsonb;
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'permission_denied' using errcode='42501';
  end if;

  with eligible as (
    select l.id,l.load_date,l.created_at
    from public.loads l
    where l.tenant_id=_tenant_id
      and l.driver_id is not null
      and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  )
  select count(*), md5(coalesce(string_agg(
    concat_ws(':',id::text,coalesce(load_date::text,''),created_at::text),
    '|' order by load_date desc nulls last,created_at desc,id
  ),''))
  into v_total,v_revision
  from eligible;

  if _expected_revision is not null and _expected_revision is distinct from v_revision then
    raise exception 'settlement_snapshot_changed' using errcode='40001';
  end if;

  with eligible as (
    select l.id,l.load_number,l.origin,l.destination,l.status,l.total_weight_kg,l.total_pallet_count,l.gross_cargo_value,l.freight_amount,
      l.invoice_count,l.load_date,l.driver_id,d.name driver_name,v.plate vehicle_plate,l.created_at
    from public.loads l
    left join public.drivers d on d.id=l.driver_id
    left join public.vehicles v on v.id=l.vehicle_id
    where l.tenant_id=_tenant_id
      and l.driver_id is not null
      and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  )
  select coalesce(jsonb_agg(to_jsonb(x)-'created_at'),'[]'::jsonb)
  into v_rows
  from (
    select * from eligible
    order by load_date desc nulls last,created_at desc,id
    limit v_size offset (v_page-1)*v_size
  ) x;

  return jsonb_build_object(
    'rows',v_rows,
    'total',v_total,
    'page',v_page,
    'page_size',v_size,
    'revision',v_revision
  );
end;
$function$;

revoke all on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer,text) from public,anon;
grant execute on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer,text) to authenticated,service_role;
