CREATE TABLE public.load_note_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  load_id UUID NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  fiscal_document_id UUID REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL DEFAULT 'linked',
  invoice_number TEXT,
  client_name TEXT,
  supplier_name TEXT,
  neighborhood TEXT,
  route_destination TEXT,
  previous_load_id UUID REFERENCES public.loads(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.load_note_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view load note audit events"
ON public.load_note_audit_events
FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Members can create load note audit events"
ON public.load_note_audit_events
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX idx_load_note_audit_events_load_created
ON public.load_note_audit_events (load_id, created_at DESC);

CREATE INDEX idx_load_note_audit_events_tenant_created
ON public.load_note_audit_events (tenant_id, created_at DESC);

CREATE INDEX idx_load_note_audit_events_fiscal_document
ON public.load_note_audit_events (fiscal_document_id);