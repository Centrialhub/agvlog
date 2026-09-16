set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Avoid overlapping permissive SELECT policies while preserving the same
-- contract: every active member reads, only tenant administrators mutate.
drop policy if exists "Admins can manage geofences" on public.geofences;

drop policy if exists "Admins can insert geofences" on public.geofences;
create policy "Admins can insert geofences" on public.geofences
  for insert to authenticated
  with check (
    private.request_tenant_id()=tenant_id
    and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id)
  );

drop policy if exists "Admins can update geofences" on public.geofences;
create policy "Admins can update geofences" on public.geofences
  for update to authenticated
  using (
    private.request_tenant_id()=tenant_id
    and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id)
  )
  with check (
    private.request_tenant_id()=tenant_id
    and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id)
  );

drop policy if exists "Admins can delete geofences" on public.geofences;
create policy "Admins can delete geofences" on public.geofences
  for delete to authenticated
  using (
    private.request_tenant_id()=tenant_id
    and private.is_request_tenant_member(tenant_id)
    and public.is_tenant_admin(tenant_id)
  );
