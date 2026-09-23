create index if not exists route_waypoints_tenant_route_label_idx
  on public.route_waypoints (tenant_id, route_id, label);

create or replace function public.list_operator_routes_page_v1(
  _tenant_id uuid,
  _search text default null,
  _status text default 'all',
  _corridor text default 'all',
  _page integer default 1,
  _page_limit integer default 25
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(_search), '');
  v_pattern text;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  if _page < 1 or _page_limit < 1 or _page_limit > 100
    or _status not in ('all', 'active', 'inactive')
    or _corridor not in ('all', 'yes', 'no') then
    raise exception 'operator_route_list_invalid_filters';
  end if;
  v_pattern := case when v_search is null then null else '%' ||
    replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_offset := (_page - 1) * _page_limit;

  with filtered as (
    select rt.id
    from public.route_templates rt
    where rt.tenant_id = _tenant_id
      and (_status = 'all' or rt.enabled = (_status = 'active'))
      and (_corridor = 'all' or (rt.corridor_geofence_id is not null) = (_corridor = 'yes'))
      and (v_pattern is null
        or rt.name ilike v_pattern escape '\'
        or exists (
          select 1 from public.geofences g
          where g.id = rt.corridor_geofence_id and g.tenant_id = _tenant_id
            and g.name ilike v_pattern escape '\'
        )
        or exists (
          select 1 from public.route_waypoints rw
          where rw.route_id = rt.id and rw.tenant_id = _tenant_id
            and rw.label ilike v_pattern escape '\'
        ))
  ) select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(to_jsonb(page_row) order by page_row.created_at desc, page_row.id), '[]'::jsonb)
  into v_rows
  from (
    select rt.*, case when g.id is null then null else jsonb_build_object('name', g.name) end as geofences
    from public.route_templates rt
    left join public.geofences g on g.id = rt.corridor_geofence_id and g.tenant_id = _tenant_id
    where rt.tenant_id = _tenant_id
      and (_status = 'all' or rt.enabled = (_status = 'active'))
      and (_corridor = 'all' or (rt.corridor_geofence_id is not null) = (_corridor = 'yes'))
      and (v_pattern is null
        or rt.name ilike v_pattern escape '\'
        or g.name ilike v_pattern escape '\'
        or exists (
          select 1 from public.route_waypoints rw
          where rw.route_id = rt.id and rw.tenant_id = _tenant_id
            and rw.label ilike v_pattern escape '\'
        ))
    order by rt.created_at desc, rt.id
    limit _page_limit offset v_offset
  ) page_row;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.list_operator_routes_page_v1(uuid,text,text,text,integer,integer) from public, anon;
grant execute on function public.list_operator_routes_page_v1(uuid,text,text,text,integer,integer) to authenticated, service_role;
