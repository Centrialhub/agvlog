create or replace function public.merge_tenant_pipeline_health_v1(
  _tenant_id uuid,
  _patch jsonb,
  _increment_success boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_settings jsonb;
  v_previous_health jsonb;
  v_health jsonb;
  v_history jsonb;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select coalesce(settings,'{}'::jsonb) into v_settings from public.tenants where id=_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  v_previous_health:=coalesce(v_settings->'pipeline_health','{}'::jsonb);
  v_health:=v_previous_health||coalesce(_patch,'{}'::jsonb);

  if _increment_success then
    v_history:=v_previous_health->'recent_successful_runs';
    if jsonb_typeof(v_history) is distinct from 'array' then v_history:='[]'::jsonb; end if;
    select coalesce(jsonb_agg(entry.value order by entry.ordinality),'[]'::jsonb) into v_history
    from (
      select item.value,item.ordinality
      from jsonb_array_elements(v_history||jsonb_build_array(to_jsonb(v_now::text))) with ordinality item(value,ordinality)
      order by item.ordinality desc
      limit 600
    ) entry;
    v_health:=v_health||jsonb_build_object(
      'first_successful_run_at',coalesce(v_previous_health->>'first_successful_run_at',_patch->>'first_successful_run_at',v_now::text),
      'successful_run_count',coalesce((v_previous_health->>'successful_run_count')::bigint,0)+1,
      'recent_successful_runs',v_history
    );
  elsif coalesce(_patch->>'last_run_status','') in ('failed','partial','attention_required') then
    v_health:=v_health||jsonb_build_object('last_failed_run_at',v_now::text);
  end if;

  update public.tenants set settings=v_settings||jsonb_build_object('pipeline_health',v_health),updated_at=v_now where id=_tenant_id;
  return v_health;
end
$function$;

revoke all on function public.merge_tenant_pipeline_health_v1(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.merge_tenant_pipeline_health_v1(uuid,jsonb,boolean) to service_role;
