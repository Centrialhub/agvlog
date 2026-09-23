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
  if not found then raise exception 'route_template_not_found' using errcode='P0002'; end if;
  if not v_route.enabled then
    return jsonb_build_object('version',1,'tenant_id',_tenant_id,'route_id',v_route.id,
      'enabled',false,'archived',false,'already_archived',true,'revision',v_route.revision);
  end if;

  v_before:=to_jsonb(v_route);
  update public.route_templates
  set enabled=false,revision=revision+1,updated_at=clock_timestamp()
  where id=v_route.id and enabled
  returning * into v_route;
  if not found then
    raise exception 'route_template_archive_changed' using errcode='40001';
  end if;
  perform public._log_entity_audit(_tenant_id,'route_template',v_route.id,'archive',v_before,to_jsonb(v_route),'archive_route_template_v1');
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'route_id',v_route.id,
    'enabled',false,'archived',true,'already_archived',false,'revision',v_route.revision);
end;
$function$;

comment on function public.archive_route_template_v1(uuid,uuid) is
  'Archives an active monitored route once; repeated calls report an explicit no-op without duplicate audit.';
