create or replace function public.get_geofence_dashboard_v1(
  _tenant_id uuid,
  _page integer default 1,
  _page_size integer default 30,
  _filters jsonb default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  search_text text:=btrim(coalesce(_filters->>'search',''));
  category_filter text:=coalesce(nullif(_filters->>'category',''),'all');
  status_filter text:=coalesce(nullif(_filters->>'status',''),'all');
  result jsonb;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) then
    raise exception 'tenant_access_denied' using errcode='42501';
  end if;
  if jsonb_typeof(_filters) is distinct from 'object'
     or _page not between 1 and 1000000
     or _page_size not between 1 and 100
     or length(search_text)>200
     or category_filter not in('all','base','client','restricted','general')
     or status_filter not in('all','active','inactive') then
    raise exception 'invalid_geofence_dashboard_filters' using errcode='22023';
  end if;

  with matched as materialized (
    select geofence.*
    from public.geofences geofence
    where geofence.tenant_id=_tenant_id
      and (category_filter='all' or coalesce(geofence.category,'general')=category_filter)
      and (status_filter='all' or geofence.enabled=(status_filter='active'))
      and (
        search_text=''
        or geofence.name ilike '%'||replace(replace(search_text,'\','\\'),'%','\%')||'%' escape '\'
        or coalesce(geofence.category,'general') ilike '%'||search_text||'%'
      )
  ),
  page_rows as materialized (
    select * from matched
    order by created_at desc,id
    limit _page_size offset (_page-1)*_page_size
  ),
  inside_candidates as materialized (
    select state.*,vehicle.plate,geofence.name geofence_name
    from public.geofence_states state
    join page_rows geofence on geofence.id=state.geofence_id and geofence.enabled
    join public.positions_last position
      on position.tenant_id=state.tenant_id and position.vehicle_id=state.vehicle_id
     and position.captured_at>=clock_timestamp()-interval '10 minutes'
    left join public.vehicles vehicle
      on vehicle.tenant_id=state.tenant_id and vehicle.id=state.vehicle_id
    where state.tenant_id=_tenant_id and state.is_inside
    order by state.last_changed_at desc,state.vehicle_id,state.geofence_id
    limit 201
  ),
  position_candidates as materialized (
    select position.vehicle_id,position.lat,position.lng,position.captured_at,vehicle.plate
    from public.positions_last position
    left join public.vehicles vehicle
      on vehicle.tenant_id=position.tenant_id and vehicle.id=position.vehicle_id
    where position.tenant_id=_tenant_id
      and position.captured_at>=clock_timestamp()-interval '10 minutes'
    order by position.captured_at desc,position.vehicle_id
    limit 201
  )
  select jsonb_build_object(
    'tenant_id',_tenant_id,
    'page',_page,
    'page_size',_page_size,
    'total',(select count(*) from matched),
    'all_total',(select count(*) from public.geofences where tenant_id=_tenant_id),
    'active_count',(
      select count(*) from public.geofences
      where tenant_id=_tenant_id and enabled and center_lat is not null and center_lng is not null
    ),
    'vehicles_inside',(
      select count(distinct state.vehicle_id)
      from public.geofence_states state
      join public.geofences geofence
        on geofence.tenant_id=state.tenant_id and geofence.id=state.geofence_id and geofence.enabled
      join public.positions_last position
        on position.tenant_id=state.tenant_id and position.vehicle_id=state.vehicle_id
       and position.captured_at>=clock_timestamp()-interval '10 minutes'
      where state.tenant_id=_tenant_id and state.is_inside
    ),
    'rows',coalesce((select jsonb_agg(to_jsonb(row_value) order by created_at desc,id) from page_rows row_value),'[]'::jsonb),
    'inside_rows',coalesce((select jsonb_agg(to_jsonb(row_value) order by last_changed_at desc,vehicle_id,geofence_id) from (select * from inside_candidates limit 200) row_value),'[]'::jsonb),
    'inside_truncated',(select count(*)>200 from inside_candidates),
    'positions',coalesce((select jsonb_agg(to_jsonb(row_value) order by captured_at desc,vehicle_id) from (select * from position_candidates limit 200) row_value),'[]'::jsonb),
    'positions_truncated',(select count(*)>200 from position_candidates)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb)
to authenticated;

create index if not exists geofences_tenant_created_page_idx
on public.geofences(tenant_id,created_at desc,id);
create index if not exists geofence_states_tenant_inside_page_idx
on public.geofence_states(tenant_id,geofence_id,last_changed_at desc)
where is_inside;
create index if not exists positions_last_tenant_fresh_idx
on public.positions_last(tenant_id,captured_at desc,vehicle_id);
