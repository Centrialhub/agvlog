do $migration$
declare
  definition text;
  changed text;
begin
  select pg_get_functiondef('private.add_driver_progress_unsafe_20260917(jsonb)'::regprocedure)
  into definition;
  changed:=replace(definition,
    $old$v_today date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;$old$,
    $new$v_timezone text;
  v_today date;$new$);
  changed:=replace(changed,
    $old$if v_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;$old$,
    $new$if v_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  v_timezone:=private.driver_monitor_tenant_timezone(v_tenant);
  v_today:=(clock_timestamp() at time zone v_timezone)::date;$new$);
  changed:=replace(changed,
    $old$(v_monitor_row.started_at at time zone 'America/Sao_Paulo')::date$old$,
    $new$(v_monitor_row.started_at at time zone v_timezone)::date$new$);
  changed:=replace(changed,
    $old$at time zone 'America/Sao_Paulo'$old$,
    $new$at time zone v_timezone$new$);
  if changed=definition or position('America/Sao_Paulo' in changed)>0
     or position('driver_monitor_tenant_timezone(v_tenant)' in changed)=0 then
    raise exception 'driver_progress_timezone_patch_failed' using errcode='55000';
  end if;
  execute changed;
end;
$migration$;

comment on function private.add_driver_progress_unsafe_20260917(jsonb) is
  'Records driver progress using the active tenant civil timezone for validation and timestamps.';
