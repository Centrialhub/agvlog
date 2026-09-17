create or replace function private.add_driver_progress_unsafe_20260917(_payload jsonb)
returns jsonb
language plpgsql
set search_path=''
set row_security='on'
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id','')::uuid;
  v_monitor uuid := nullif(_payload->>'monitor_id','')::uuid;
  v_request uuid := nullif(_payload->>'request_id','')::uuid;
  v_monitor_row public.driver_route_monitors%rowtype;
  v_row public.driver_route_progress_updates%rowtype;
  v_quantity integer := coalesce(nullif(_payload->>'deliveries_completed_in_city','')::integer, 0);
  v_update_date date := nullif(_payload->>'update_date','')::date;
  v_city_finished_at time := nullif(_payload->>'city_finished_at','')::time;
  v_update_at timestamptz;
  v_effective_last_update timestamptz;
  v_completed integer;
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
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
  if v_update_date is null
     or v_update_date > v_today
     or (v_monitor_row.started_at is not null
         and v_update_date < (v_monitor_row.started_at at time zone 'America/Sao_Paulo')::date) then
    raise exception 'driver_progress_date_outside_monitor_period' using errcode = '22007';
  end if;

  v_update_at := (v_update_date::timestamp + coalesce(v_city_finished_at,time '00:00'))
    at time zone 'America/Sao_Paulo';
  v_effective_last_update := case
    when v_monitor_row.last_update_at is null then v_update_at
    else greatest(v_monitor_row.last_update_at,v_update_at)
  end;

  insert into public.driver_route_progress_updates(
    tenant_id,monitor_id,driver_id,load_id,update_date,city,deliveries_completed_in_city,
    next_city,next_city_deliveries,city_finished_at,observation,source_type,created_by,request_id
  ) values (
    v_tenant,v_monitor,v_monitor_row.driver_id,v_monitor_row.load_id,v_update_date,
    nullif(_payload->>'city',''),v_quantity,nullif(_payload->>'next_city',''),
    nullif(_payload->>'next_city_deliveries','')::integer,v_city_finished_at,
    nullif(_payload->>'observation',''),'manual',auth.uid(),v_request
  ) returning * into v_row;

  v_completed := v_monitor_row.completed_deliveries + v_quantity;
  v_status := private.driver_monitor_effective_status_tenant(v_tenant,
    v_monitor_row.status,v_monitor_row.total_deliveries,v_completed,v_monitor_row.expected_return_date,
    v_monitor_row.actual_returned_at,v_effective_last_update,v_monitor_row.notes,v_now
  );
  update public.driver_route_monitors
  set completed_deliveries = v_completed,
      remaining_deliveries = total_deliveries - v_completed,
      current_city = coalesce(nullif(_payload->>'city',''),current_city),
      next_city = coalesce(nullif(_payload->>'next_city',''),next_city),
      last_update_at = v_effective_last_update,
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
