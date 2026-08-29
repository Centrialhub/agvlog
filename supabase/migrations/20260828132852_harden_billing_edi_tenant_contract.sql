-- Tenant-safe parent keys and covering indexes for the DOCCOB graph.
CREATE UNIQUE INDEX IF NOT EXISTS billing_edi_profiles_tenant_id_id_uidx
  ON public.billing_edi_profiles (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_edi_exports_tenant_id_id_uidx
  ON public.billing_edi_exports (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_edi_exports_tenant_profile
  ON public.billing_edi_exports (tenant_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_edi_items_tenant_receivable
  ON public.billing_edi_export_items (tenant_id, receivable_id);

ALTER TABLE public.billing_edi_profiles
  DROP CONSTRAINT IF EXISTS billing_edi_profiles_client_id_fkey,
  ADD CONSTRAINT billing_edi_profiles_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.billing_edi_exports
  DROP CONSTRAINT IF EXISTS billing_edi_exports_client_id_fkey,
  DROP CONSTRAINT IF EXISTS billing_edi_exports_profile_id_fkey,
  ADD CONSTRAINT billing_edi_exports_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (client_id)
    NOT VALID,
  ADD CONSTRAINT billing_edi_exports_profile_id_fkey
    FOREIGN KEY (tenant_id, profile_id)
    REFERENCES public.billing_edi_profiles (tenant_id, id)
    ON DELETE SET NULL (profile_id)
    NOT VALID;

ALTER TABLE public.billing_edi_export_items
  DROP CONSTRAINT IF EXISTS billing_edi_export_items_export_id_fkey,
  DROP CONSTRAINT IF EXISTS billing_edi_export_items_client_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS billing_edi_export_items_receivable_id_fkey,
  ADD CONSTRAINT billing_edi_export_items_export_id_fkey
    FOREIGN KEY (tenant_id, export_id)
    REFERENCES public.billing_edi_exports (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT billing_edi_export_items_client_invoice_id_fkey
    FOREIGN KEY (tenant_id, client_invoice_id)
    REFERENCES public.client_invoices (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT billing_edi_export_items_receivable_id_fkey
    FOREIGN KEY (tenant_id, receivable_id)
    REFERENCES public.receivables (tenant_id, id)
    ON DELETE SET NULL (receivable_id)
    NOT VALID;

ALTER TABLE public.billing_edi_profiles
  VALIDATE CONSTRAINT billing_edi_profiles_client_id_fkey;
ALTER TABLE public.billing_edi_exports
  VALIDATE CONSTRAINT billing_edi_exports_client_id_fkey,
  VALIDATE CONSTRAINT billing_edi_exports_profile_id_fkey;
ALTER TABLE public.billing_edi_export_items
  VALIDATE CONSTRAINT billing_edi_export_items_export_id_fkey,
  VALIDATE CONSTRAINT billing_edi_export_items_client_invoice_id_fkey,
  VALIDATE CONSTRAINT billing_edi_export_items_receivable_id_fkey;
