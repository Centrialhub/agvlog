-- Cover the composite tenant-safe charge/detail foreign key.
-- Production migration version: 20260828124136.
CREATE INDEX IF NOT EXISTS client_invoice_details_tenant_charge_invoice_idx
  ON public.client_invoice_details (tenant_id, charge_id, invoice_id);
