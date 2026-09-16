set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regclass('public.geofences') is null
    or to_regclass('public.address_resolution_queue') is null
    or to_regclass('public.address_resolution_audit_events') is null
    or to_regclass('public.clients') is null
    or to_regprocedure('public.upsert_geofence(uuid,uuid,text,text,text,boolean)') is null then
    raise exception 'harden_geofence_runtime_prerequisites_missing';
  end if;
end;
$preflight$;

-- These indexes cover the foreign keys exercised by canonical-address refreshes
-- and queue cleanup. They also remove sequential scans from the automated worker.
create index if not exists idx_address_resolution_audit_queue
  on public.address_resolution_audit_events(queue_id)
  where queue_id is not null;

create index if not exists idx_address_resolution_queue_canonical
  on public.address_resolution_queue(tenant_id,canonical_address_id)
  where canonical_address_id is not null;

create index if not exists idx_clients_canonical_address
  on public.clients(tenant_id,canonical_address_id)
  where canonical_address_id is not null;

-- A later generic RLS reassertion recreated permissive policies next to the
-- stricter active-tenant policies. Preserve the explicit geofence contract:
-- members read, tenant administrators manage.
drop policy if exists agvlog_active_tenant_context on public.geofences;
drop policy if exists agvlog_delete_authenticated on public.geofences;
drop policy if exists agvlog_insert_authenticated on public.geofences;
drop policy if exists agvlog_select_authenticated on public.geofences;
drop policy if exists agvlog_update_authenticated on public.geofences;

-- Retire the superseded free-form geometry RPC from the browser surface.
-- Service workers retain access for backwards-compatible internal recovery.
revoke all on function public.upsert_geofence(uuid,uuid,text,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.upsert_geofence(uuid,uuid,text,text,text,boolean)
  to service_role;
