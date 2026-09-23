alter table public.tenant_tracking_schedules add column if not exists configuration_updated_at timestamptz;
update public.tenant_tracking_schedules set configuration_updated_at=coalesce(configuration_updated_at,updated_at,clock_timestamp());
alter table public.tenant_tracking_schedules alter column configuration_updated_at set default clock_timestamp();
alter table public.tenant_tracking_schedules alter column configuration_updated_at set not null;

create or replace function public.audit_tracking_schedule_configuration_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if row(old.enabled,old.poll_interval_minutes,old.full_sync_interval_hours)
    is distinct from row(new.enabled,new.poll_interval_minutes,new.full_sync_interval_hours) then
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(new.tenant_id,'tenant_tracking_schedule',new.tenant_id,'configuration_update',to_jsonb(old),to_jsonb(new),auth.uid(),'integration_health');
  end if;
  return new;
end;
$function$;
drop trigger if exists audit_tracking_schedule_configuration_v1 on public.tenant_tracking_schedules;
create trigger audit_tracking_schedule_configuration_v1 after update on public.tenant_tracking_schedules
for each row execute function public.audit_tracking_schedule_configuration_v1();

create or replace function public.update_tracking_schedule_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_poll integer:=nullif(_payload->>'poll_interval_minutes','')::integer;
 v_full integer:=nullif(_payload->>'full_sync_interval_hours','')::integer;v_expected timestamptz:=nullif(_payload->>'expected_updated_at','')::timestamptz;
 v_schedule public.tenant_tracking_schedules%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
  if v_poll not in(1,3,5,10,15) or v_full not in(1,3,6,12,24) then raise exception 'invalid_tracking_schedule' using errcode='22023';end if;
  select * into v_schedule from public.tenant_tracking_schedules where tenant_id=v_tenant for update;
  if v_schedule.tenant_id is null then
    if v_expected is not null then raise exception 'tracking_schedule_revision_conflict' using errcode='40001';end if;
    insert into public.tenant_tracking_schedules(tenant_id,enabled,poll_interval_minutes,full_sync_interval_hours,updated_by,configuration_updated_at)
    values(v_tenant,coalesce((_payload->>'enabled')::boolean,true),v_poll,v_full,auth.uid(),clock_timestamp()) returning * into v_schedule;
  else
    if v_expected is null or v_schedule.configuration_updated_at is distinct from v_expected then raise exception 'tracking_schedule_revision_conflict' using errcode='40001';end if;
    update public.tenant_tracking_schedules set enabled=coalesce((_payload->>'enabled')::boolean,enabled),poll_interval_minutes=v_poll,
      full_sync_interval_hours=v_full,updated_at=clock_timestamp(),updated_by=auth.uid(),configuration_updated_at=clock_timestamp()
    where tenant_id=v_tenant returning * into v_schedule;
  end if;
  return to_jsonb(v_schedule)-'tenant_id';
end;
$function$;
revoke all on function public.update_tracking_schedule_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_tracking_schedule_v1(jsonb) to authenticated;
