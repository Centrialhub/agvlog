
-- Add freight override fields on fiscal_documents
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS freight_value_original numeric,
  ADD COLUMN IF NOT EXISTS freight_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS freight_override_reason text,
  ADD COLUMN IF NOT EXISTS freight_overridden_by uuid,
  ADD COLUMN IF NOT EXISTS freight_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS freight_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS freight_confirmed_at timestamptz;

-- Audit log for freight overrides
CREATE TABLE IF NOT EXISTS public.freight_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fiscal_document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  previous_value numeric,
  new_value numeric NOT NULL,
  reason text NOT NULL,
  changed_by uuid,
  freight_breakdown_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.freight_override_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read freight_override_log"
  ON public.freight_override_log FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members insert freight_override_log"
  ON public.freight_override_log FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS idx_freight_override_log_doc ON public.freight_override_log(fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_freight_override_log_tenant ON public.freight_override_log(tenant_id, created_at DESC);
