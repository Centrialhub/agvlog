-- These tables intentionally remain inaccessible to browser roles. They are
-- read and written only by authenticated Edge Functions using service_role.
-- RLS bypass does not imply table privileges, so the explicit grants below
-- are required after the public/default grants were revoked.
grant select, insert, update
  on table public.fiscal_certificates
  to service_role;

grant select, insert
  on table public.tax_registry_queries
  to service_role;

grant select, insert, update
  on table public.fiscal_party_registry
  to service_role;
