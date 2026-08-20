
-- Create cost_centers table (retry with corrected SQL)
CREATE TABLE IF NOT EXISTS public.cost_centers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;
GRANT ALL ON public.cost_centers TO service_role;

-- Enable RLS
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

-- Policies (using DO blocks to avoid errors if policies already exist from previous partial run)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own tenant cost centers') THEN
        CREATE POLICY "Users can view their own tenant cost centers"
            ON public.cost_centers FOR SELECT
            TO authenticated
            USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert cost centers for their tenant') THEN
        CREATE POLICY "Users can insert cost centers for their tenant"
            ON public.cost_centers FOR INSERT
            TO authenticated
            WITH CHECK (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update cost centers for their tenant') THEN
        CREATE POLICY "Users can update cost centers for their tenant"
            ON public.cost_centers FOR UPDATE
            TO authenticated
            USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete cost centers for their tenant') THEN
        CREATE POLICY "Users can delete cost centers for their tenant"
            ON public.cost_centers FOR DELETE
            TO authenticated
            USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
    END IF;
END $$;

-- Backfill from existing hook's defaults if any tenant exists
INSERT INTO public.cost_centers (tenant_id, name)
SELECT t.id, n.val
FROM public.tenants t,
UNNEST(ARRAY['Operacional', 'Administrativo', 'Manutenção', 'Combustível', 'RH', 'Financeiro', 'Frota', 'Armazém']) AS n(val)
ON CONFLICT (tenant_id, name) DO NOTHING;
