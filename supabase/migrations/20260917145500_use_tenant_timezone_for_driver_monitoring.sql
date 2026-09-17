create or replace function private.driver_monitor_tenant_timezone(_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select tenant.timezone
    from public.tenants tenant
    where tenant.id = _tenant_id
      and tenant.timezone is not null
      and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name = tenant.timezone)
  ), 'America/Sao_Paulo');
$function$;

revoke all on function private.driver_monitor_tenant_timezone(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.driver_monitor_effective_status_tenant(
  _tenant_id uuid,
  _status text,
  _total integer,
  _completed integer,
  _expected_return date,
  _actual_returned timestamptz,
  _last_update timestamptz,
  _notes text,
  _now timestamptz default clock_timestamp()
) returns text
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
    when _expected_return is not null
      and (_now at time zone private.driver_monitor_tenant_timezone(_tenant_id))::date > _expected_return then 'delayed'
    when _last_update is not null and _now - _last_update > interval '24 hours' then 'no_update'
    else 'on_time'
  end;
$function$;

revoke all on function private.driver_monitor_effective_status_tenant(uuid,text,integer,integer,date,timestamptz,timestamptz,text,timestamptz)
  from public, anon, authenticated, service_role;

-- Rebuild the three canonical writers while preserving their complete current
-- definitions, privileges and safety settings. Replace only the two legacy
-- timezone assumptions and the status helper call; all writers already carry
-- v_tenant in their locked transaction context.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.add_driver_progress_v1(jsonb)'::regprocedure,
    'public.add_driver_forecast_v1(jsonb)'::regprocedure,
    'private.import_driver_monitoring_workbook_unsafe_20260917(jsonb)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    v_definition := replace(
      v_definition,
      'private.driver_monitor_effective_status(',
      'private.driver_monitor_effective_status_tenant(v_tenant,'
    );
    v_definition := replace(
      v_definition,
      '''America/Sao_Paulo''',
      'private.driver_monitor_tenant_timezone(v_tenant)'
    );
    execute v_definition;
  end loop;
end;
$migration$;
