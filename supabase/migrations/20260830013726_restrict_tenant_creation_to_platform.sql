-- Applied as 20260830013726. Tenant provisioning is a platform operation. The legacy helper derived the
-- owner from auth.uid(), which meant that any authenticated user could create
-- a new tenant and appoint themselves as owner. Keep the function for database
-- compatibility, but remove it from every Data API role. Platform provisioning
-- must use an audited backend workflow instead of this legacy RPC.
revoke all privileges
  on function public.create_tenant_with_owner(text)
  from public, anon, authenticated, service_role;

comment on function public.create_tenant_with_owner(text) is
  'Deprecated and not exposed through the Data API. Tenant provisioning is restricted to the platform backend.';
