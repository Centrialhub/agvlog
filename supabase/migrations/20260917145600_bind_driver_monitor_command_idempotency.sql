alter table public.driver_route_progress_updates add column if not exists payload_hash text;
alter table public.driver_arrival_forecasts add column if not exists payload_hash text;

alter function public.add_driver_progress_v1(jsonb) rename to add_driver_progress_unsafe_20260917;
alter function public.add_driver_progress_unsafe_20260917(jsonb) set schema private;
revoke all on function private.add_driver_progress_unsafe_20260917(jsonb)
  from public,anon,authenticated,service_role;

create function public.add_driver_progress_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_monitor uuid:=nullif(_payload->>'monitor_id','')::uuid;
  v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_hash text;
  v_existing public.driver_route_progress_updates%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501';end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant) or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode='42501';end if;
  if v_request is null then raise exception 'request_id_required' using errcode='22023';end if;
  if v_monitor is null then raise exception 'monitor_id_required' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text||':driver-progress:'||v_request::text,0));
  select * into v_existing from public.driver_route_progress_updates
    where tenant_id=v_tenant and request_id=v_request for update;
  if found then
    if v_existing.monitor_id<>v_monitor or v_existing.created_by is distinct from auth.uid()
       or (v_existing.payload_hash is not null and v_existing.payload_hash<>v_hash) then
      raise exception 'driver_progress_request_payload_mismatch' using errcode='22023';
    end if;
    if v_existing.payload_hash is null then update public.driver_route_progress_updates set payload_hash=v_hash where id=v_existing.id;end if;
    return to_jsonb(v_existing);
  end if;
  v_result:=private.add_driver_progress_unsafe_20260917(_payload);
  update public.driver_route_progress_updates set payload_hash=v_hash
    where tenant_id=v_tenant and request_id=v_request and monitor_id=v_monitor;
  if not found then raise exception 'driver_progress_not_persisted' using errcode='40001';end if;
  return v_result||jsonb_build_object('payload_hash',v_hash);
end;$function$;

alter function public.add_driver_forecast_v1(jsonb) rename to add_driver_forecast_unsafe_20260917;
alter function public.add_driver_forecast_unsafe_20260917(jsonb) set schema private;
revoke all on function private.add_driver_forecast_unsafe_20260917(jsonb)
  from public,anon,authenticated,service_role;

create function public.add_driver_forecast_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_monitor uuid:=nullif(_payload->>'monitor_id','')::uuid;
  v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_hash text;
  v_existing public.driver_arrival_forecasts%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501';end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant) or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode='42501';end if;
  if v_request is null then raise exception 'request_id_required' using errcode='22023';end if;
  if v_monitor is null then raise exception 'monitor_id_required' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text||':driver-forecast:'||v_request::text,0));
  select * into v_existing from public.driver_arrival_forecasts
    where tenant_id=v_tenant and request_id=v_request for update;
  if found then
    if v_existing.monitor_id<>v_monitor or v_existing.created_by is distinct from auth.uid()
       or (v_existing.payload_hash is not null and v_existing.payload_hash<>v_hash) then
      raise exception 'driver_forecast_request_payload_mismatch' using errcode='22023';
    end if;
    if v_existing.payload_hash is null then update public.driver_arrival_forecasts set payload_hash=v_hash where id=v_existing.id;end if;
    return to_jsonb(v_existing);
  end if;
  v_result:=private.add_driver_forecast_unsafe_20260917(_payload);
  update public.driver_arrival_forecasts set payload_hash=v_hash
    where tenant_id=v_tenant and request_id=v_request and monitor_id=v_monitor;
  if not found then raise exception 'driver_forecast_not_persisted' using errcode='40001';end if;
  return v_result||jsonb_build_object('payload_hash',v_hash);
end;$function$;

revoke all on function public.add_driver_progress_v1(jsonb),public.add_driver_forecast_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.add_driver_progress_v1(jsonb),public.add_driver_forecast_v1(jsonb)
  to authenticated,service_role;
