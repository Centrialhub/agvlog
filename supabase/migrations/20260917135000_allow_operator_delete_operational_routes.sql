-- Operators manage the operational-route catalog in the application, so DELETE
-- must follow the same tenant-scoped authorization used by its other mutations.
drop policy if exists "Operators can delete operational_routes" on public.operational_routes;

create policy "Operators can delete operational_routes"
on public.operational_routes
for delete
to authenticated
using (public.is_tenant_operator_or_admin(tenant_id));
