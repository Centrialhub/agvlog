-- Prevent a portal grant from referencing a client owned by another tenant.
-- Production migration version: 20260828124653.
ALTER TABLE public.client_portal_access
  DROP CONSTRAINT IF EXISTS client_portal_access_client_id_fkey,
  ADD CONSTRAINT client_portal_access_tenant_client_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.client_portal_access
  VALIDATE CONSTRAINT client_portal_access_tenant_client_fkey;
