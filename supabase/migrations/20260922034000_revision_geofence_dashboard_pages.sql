create or replace function public.get_geofence_dashboard_v1(
  _tenant_id uuid,
  _page integer,
  _page_size integer,
  _filters jsonb,
  _expected_revision text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  result jsonb;
  revision text;
  search_text text:=btrim(coalesce(_filters->>'search',''));
  category_filter text:=coalesce(nullif(_filters->>'category',''),'all');
  status_filter text:=coalesce(nullif(_filters->>'status',''),'all');
  escaped_search text;
begin
  -- The four-argument reader remains the single source for validation, access,
  -- totals, live positions and row serialization in this statement snapshot.
  result:=public.get_geofence_dashboard_v1(_tenant_id,_page,_page_size,_filters);
  if _page>1 and _expected_revision is null then
    raise exception 'geofence_dashboard_revision_required' using errcode='22023';
  end if;

  escaped_search:=replace(replace(replace(search_text,'\','\\'),'%','\%'),'_','\_');
  select md5(coalesce(jsonb_agg(to_jsonb(geofence) order by geofence.created_at desc,geofence.id)::text,'[]'))
  into revision
  from public.geofences geofence
  where geofence.tenant_id=_tenant_id
    and (category_filter='all' or coalesce(geofence.category,'general')=category_filter)
    and (status_filter='all' or geofence.enabled=(status_filter='active'))
    and (
      search_text=''
      or geofence.name ilike '%'||escaped_search||'%' escape '\'
      or coalesce(geofence.category,'general') ilike '%'||escaped_search||'%' escape '\'
    );

  if _expected_revision is not null and _expected_revision is distinct from revision then
    raise exception 'geofence_dashboard_snapshot_changed' using errcode='40001';
  end if;
  return result||jsonb_build_object('revision',revision);
end;
$function$;

revoke all on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb,text)
from public,anon,authenticated,service_role;
grant execute on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb,text)
to authenticated;
