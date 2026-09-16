set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.geofences') is null
    or to_regprocedure('public.mutate_fleet_geofence_v1(jsonb)') is null
    or to_regprocedure('private.request_tenant_id()') is null
    or to_regprocedure('private.is_request_tenant_member(uuid)') is null then
    raise exception 'canonical_fleet_geofence_enforcement_prerequisites_missing';
  end if;
end;
$preflight$;

-- Contract phase: once the canonical frontend is live, every fleet mutation crosses
-- the audited, tenant-bound RPC. Service automation keeps its existing privileges.
drop policy if exists "Admins can manage geofences" on public.geofences;
drop policy if exists "Members can view geofences" on public.geofences;
drop policy if exists agvlog_active_tenant_context on public.geofences;
drop policy if exists agvlog_delete_authenticated on public.geofences;
drop policy if exists agvlog_insert_authenticated on public.geofences;
drop policy if exists agvlog_select_authenticated on public.geofences;
drop policy if exists agvlog_update_authenticated on public.geofences;
create policy geofences_active_tenant_read on public.geofences
  for select to authenticated
  using (
    private.request_tenant_id()=tenant_id
    and private.is_request_tenant_member(tenant_id)
  );
revoke insert,update,delete on table public.geofences from authenticated;
grant select on table public.geofences to authenticated;

do $postcondition$
begin
  if not has_function_privilege('authenticated','public.mutate_fleet_geofence_v1(jsonb)','execute')
    or has_function_privilege('anon','public.mutate_fleet_geofence_v1(jsonb)','execute')
    or has_table_privilege('authenticated','public.geofences','insert')
    or has_table_privilege('authenticated','public.geofences','update')
    or has_table_privilege('authenticated','public.geofences','delete')
    or (select count(*) from pg_policy where polrelid='public.geofences'::regclass)<>1
    or not exists(
      select 1 from pg_policy
      where polrelid='public.geofences'::regclass
        and polname='geofences_active_tenant_read'
        and polcmd='r'
    ) then
    raise exception 'canonical_fleet_geofence_enforcement_postcondition_failed';
  end if;
end;
$postcondition$;
