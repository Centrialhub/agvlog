create or replace function public.archive_route_template_v1(_tenant_id uuid,_route_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_route public.route_templates%rowtype;
  v_before jsonb;
begin
  if auth.uid() is null or not public.is_tenant_admin(_tenant_id) then
    raise exception 'route_admin_required' using errcode='42501';
  end if;
  select * into v_route from public.route_templates
  where id=_route_id and tenant_id=_tenant_id
  for update;
  if not found then raise exception 'route_template_not_found' using errcode='P0002';end if;
  v_before:=to_jsonb(v_route);
  update public.route_templates set enabled=false where id=v_route.id returning * into v_route;
  perform public._log_entity_audit(_tenant_id,'route_template',v_route.id,'archive',v_before,to_jsonb(v_route),'archive_route_template_v1');
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'route_id',v_route.id,'enabled',v_route.enabled,'archived',true);
end;
$function$;
revoke all on function public.archive_route_template_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.archive_route_template_v1(uuid,uuid) to authenticated,service_role;
revoke delete on table public.route_templates from authenticated;

comment on function public.archive_route_template_v1(uuid,uuid) is
  'Archives a monitored route without deleting its waypoints or historical route runs.';
