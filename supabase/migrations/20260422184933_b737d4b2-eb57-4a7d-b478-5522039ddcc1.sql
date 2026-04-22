CREATE TABLE public.reimport_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  created_by UUID,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  period_start DATE,
  period_end DATE,
  total_files INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cleanup_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors_summary JSONB NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.reimport_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can create reimport history"
ON public.reimport_batches
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Members can view reimport history"
ON public.reimport_batches
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE INDEX idx_reimport_batches_tenant_started
ON public.reimport_batches (tenant_id, started_at DESC);