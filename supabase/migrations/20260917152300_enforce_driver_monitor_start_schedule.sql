create or replace function private.enforce_driver_monitor_start_schedule()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if new.status not in ('arrived','completed','cancelled') and coalesce(new.total_deliveries,0) <= 0 then
    raise exception 'driver_monitor_requires_delivery' using errcode='23514';
  end if;

  if new.started_at is not null and coalesce(new.return_deadline_days,0) > 0 then
    new.expected_return_date := (new.started_at at time zone 'America/Sao_Paulo')::date + new.return_deadline_days;
  elsif new.return_deadline_days is not null then
    new.expected_return_date := null;
  end if;
  return new;
end
$function$;

drop trigger if exists driver_monitor_start_schedule_guard on public.driver_route_monitors;
create trigger driver_monitor_start_schedule_guard
before insert or update of started_at,return_deadline_days,expected_return_date,total_deliveries,status
on public.driver_route_monitors
for each row execute function private.enforce_driver_monitor_start_schedule();

alter table public.driver_route_monitors
  add constraint driver_route_monitors_active_delivery_count_check
  check (status in ('arrived','completed','cancelled') or total_deliveries > 0) not valid;

alter table public.driver_route_monitors
  validate constraint driver_route_monitors_active_delivery_count_check;

do $patch$
declare
  v_oid oid;
  v_body text;
  v_old text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='apply_driver_monitor_command'
    and pg_get_function_identity_arguments(p.oid)='jsonb';
  if v_oid is null then return; end if;
  v_body:=pg_get_functiondef(v_oid);

  if position('or v_total <= 0' in v_body)=0 then
    v_body:=replace(v_body,
      'or v_total < (case when v_action = ''update'' then v_old.completed_deliveries else 0 end)',
      'or v_total <= 0 or v_total < (case when v_action = ''update'' then v_old.completed_deliveries else 0 end)');
  end if;

  if position('v_expected_return := (v_started_at at time zone ''America/Sao_Paulo'')::date + v_return_days;' in v_body)=0 then
    v_old:=$old$  else
    v_return_days := case when v_action = 'update' then v_old.return_deadline_days else null end;
  end if;$old$;
    if position(v_old in v_body)=0 then raise exception 'driver_monitor_deadline_contract_changed'; end if;
    v_body:=replace(v_body,v_old,v_old||$new$
  if v_return_days is not null and v_return_days > 0 then
    v_expected_return := (v_started_at at time zone 'America/Sao_Paulo')::date + v_return_days;
  elsif v_changes ? 'return_deadline_days' then
    v_expected_return := null;
  end if;$new$);
  end if;
  execute v_body;
end
$patch$;
