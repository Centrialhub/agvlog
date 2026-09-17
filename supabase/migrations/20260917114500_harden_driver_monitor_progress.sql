create or replace function private.driver_monitor_effective_status(
  _status text,
  _total integer,
  _completed integer,
  _expected_return date,
  _actual_returned timestamptz,
  _last_update timestamptz,
  _notes text,
  _now timestamptz default clock_timestamp()
)
returns text
language sql
stable
set search_path = ''
as $function$
  select case
    when _status = 'cancelled' then 'cancelled'
    when _actual_returned is not null then case when _status = 'arrived' then 'arrived' else 'completed' end
    when _status = 'waiting_load' then 'waiting_load'
    when coalesce(_total, 0) > 0 and coalesce(_completed, 0) >= _total then 'returning'
    when coalesce(_notes, '') ~* '(crítico|critico|acidente|urgente|problema)' then 'issue'
    when _expected_return is not null and (_now at time zone 'America/Sao_Paulo')::date > _expected_return then 'delayed'
    when _last_update is not null and _now - _last_update > interval '24 hours' then 'no_update'
    else 'on_time'
  end;
$function$;

create or replace function public.add_driver_progress_v1(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id','')::uuid;
  v_monitor uuid := nullif(_payload->>'monitor_id','')::uuid;
  v_request uuid := nullif(_payload->>'request_id','')::uuid;
  v_monitor_row public.driver_route_monitors%rowtype;
  v_row public.driver_route_progress_updates%rowtype;
  v_quantity integer := coalesce(nullif(_payload->>'deliveries_completed_in_city','')::integer, 0);
  v_completed integer;
  v_now timestamptz := clock_timestamp();
  v_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant) or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if v_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  select * into v_row from public.driver_route_progress_updates where tenant_id = v_tenant and request_id = v_request;
  if found then return to_jsonb(v_row); end if;

  select * into v_monitor_row from public.driver_route_monitors
  where id = v_monitor and tenant_id = v_tenant for update;
  if not found then raise exception 'monitor_not_found'; end if;
  if v_monitor_row.status in ('arrived','completed','cancelled') then
    raise exception 'monitor_is_closed' using errcode = '23514';
  end if;
  if v_quantity < 0 or v_quantity > greatest(v_monitor_row.total_deliveries - v_monitor_row.completed_deliveries, 0) then
    raise exception 'progress_exceeds_remaining_deliveries' using errcode = '23514';
  end if;

  insert into public.driver_route_progress_updates(
    tenant_id,monitor_id,driver_id,load_id,update_date,city,deliveries_completed_in_city,
    next_city,next_city_deliveries,city_finished_at,observation,source_type,created_by,request_id
  ) values (
    v_tenant,v_monitor,v_monitor_row.driver_id,v_monitor_row.load_id,(_payload->>'update_date')::date,
    nullif(_payload->>'city',''),v_quantity,nullif(_payload->>'next_city',''),
    nullif(_payload->>'next_city_deliveries','')::integer,nullif(_payload->>'city_finished_at','')::timestamptz,
    nullif(_payload->>'observation',''),'manual',auth.uid(),v_request
  ) returning * into v_row;

  v_completed := v_monitor_row.completed_deliveries + v_quantity;
  v_status := private.driver_monitor_effective_status(
    v_monitor_row.status,v_monitor_row.total_deliveries,v_completed,v_monitor_row.expected_return_date,
    v_monitor_row.actual_returned_at,v_now,v_monitor_row.notes,v_now
  );
  update public.driver_route_monitors
  set completed_deliveries = v_completed,
      remaining_deliveries = total_deliveries - v_completed,
      current_city = coalesce(nullif(_payload->>'city',''),current_city),
      next_city = coalesce(nullif(_payload->>'next_city',''),next_city),
      last_update_at = v_now,
      status = v_status,
      updated_at = v_now,
      updated_by = auth.uid(),
      revision = revision + 1
  where id = v_monitor and tenant_id = v_tenant;

  insert into public.driver_monitoring_history(tenant_id,monitor_id,action,new_value,created_by)
  values(v_tenant,v_monitor,'progress_update',coalesce(_payload->>'city','')||' (+'||v_quantity::text||')',auth.uid());
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.add_driver_forecast_v1(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id','')::uuid;
  v_monitor uuid := nullif(_payload->>'monitor_id','')::uuid;
  v_request uuid := nullif(_payload->>'request_id','')::uuid;
  v_monitor_row public.driver_route_monitors%rowtype;
  v_row public.driver_arrival_forecasts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant) or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if v_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  select * into v_row from public.driver_arrival_forecasts where tenant_id = v_tenant and request_id = v_request;
  if found then return to_jsonb(v_row); end if;

  select * into v_monitor_row from public.driver_route_monitors
  where id = v_monitor and tenant_id = v_tenant for update;
  if not found then raise exception 'monitor_not_found'; end if;
  if v_monitor_row.status in ('arrived','completed','cancelled') then
    raise exception 'monitor_is_closed' using errcode = '23514';
  end if;

  insert into public.driver_arrival_forecasts(
    tenant_id,monitor_id,driver_id,forecast_date,forecast_time,current_city,forecast_text,
    remaining_cities_text,observation,status,created_by,request_id
  ) values (
    v_tenant,v_monitor,v_monitor_row.driver_id,(_payload->>'forecast_date')::date,
    nullif(_payload->>'forecast_time','')::time,nullif(_payload->>'current_city',''),
    nullif(_payload->>'forecast_text',''),nullif(_payload->>'remaining_cities_text',''),
    nullif(_payload->>'observation',''),'active',auth.uid(),v_request
  ) returning * into v_row;

  v_status := private.driver_monitor_effective_status(
    v_monitor_row.status,v_monitor_row.total_deliveries,v_monitor_row.completed_deliveries,
    v_monitor_row.expected_return_date,v_monitor_row.actual_returned_at,v_now,v_monitor_row.notes,v_now
  );
  update public.driver_route_monitors
  set arrival_forecast_text = nullif(_payload->>'forecast_text',''),
      arrival_forecast_at = case
        when nullif(_payload->>'forecast_time','') is null then (_payload->>'forecast_date')::date::timestamp at time zone 'America/Sao_Paulo'
        else ((_payload->>'forecast_date')::date + (_payload->>'forecast_time')::time) at time zone 'America/Sao_Paulo'
      end,
      current_city = coalesce(nullif(_payload->>'current_city',''),current_city),
      last_update_at = v_now,
      status = v_status,
      updated_at = v_now,
      updated_by = auth.uid(),
      revision = revision + 1
  where id = v_monitor and tenant_id = v_tenant;
  return to_jsonb(v_row);
end;
$function$;

create or replace function private.preserve_driver_monitor_arrival_time()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.actual_returned_at is not null and new.actual_returned_at is distinct from old.actual_returned_at then
    raise exception 'driver_monitor_arrival_time_immutable' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists preserve_driver_monitor_arrival_time on public.driver_route_monitors;
create trigger preserve_driver_monitor_arrival_time
before update of actual_returned_at on public.driver_route_monitors
for each row execute function private.preserve_driver_monitor_arrival_time();

revoke all on function private.driver_monitor_effective_status(text,integer,integer,date,timestamptz,timestamptz,text,timestamptz),
  private.preserve_driver_monitor_arrival_time() from public,anon,authenticated,service_role;
revoke all on function public.add_driver_progress_v1(jsonb), public.add_driver_forecast_v1(jsonb) from public,anon;
grant execute on function public.add_driver_progress_v1(jsonb), public.add_driver_forecast_v1(jsonb) to authenticated,service_role;

comment on function private.driver_monitor_effective_status(text,integer,integer,date,timestamptz,timestamptz,text,timestamptz) is
  'Canonical driver monitoring status calculation shared by operational mutations.';
