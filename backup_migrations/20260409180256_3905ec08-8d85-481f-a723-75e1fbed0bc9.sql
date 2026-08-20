
-- =============================================
-- 1. EXPAND freight_tables
-- =============================================
ALTER TABLE public.freight_tables
  ADD COLUMN IF NOT EXISTS cargo_type text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS body_type text,
  ADD COLUMN IF NOT EXISTS ctrc_type text,
  ADD COLUMN IF NOT EXISTS dispatch_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loading_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gris_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS specificity_score integer DEFAULT 0;

-- =============================================
-- 2. EXPAND fiscal_documents with IBS/CBS + freight audit
-- =============================================
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS cbs_base numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cbs_rate numeric DEFAULT 0.90,
  ADD COLUMN IF NOT EXISTS cbs_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ibs_base numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ibs_rate numeric DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS ibs_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_breakdown jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS freight_table_id uuid;

-- =============================================
-- 3. EXPAND orders with freight audit links
-- =============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS freight_region_id uuid,
  ADD COLUMN IF NOT EXISTS freight_table_id uuid,
  ADD COLUMN IF NOT EXISTS freight_breakdown jsonb DEFAULT '{}'::jsonb;

-- =============================================
-- 4. freight_calculation_log — audit trail
-- =============================================
CREATE TABLE IF NOT EXISTS public.freight_calculation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type text NOT NULL, -- 'order' or 'fiscal_document'
  entity_id uuid NOT NULL,
  region_id uuid,
  region_name text,
  freight_table_id uuid,
  freight_table_name text,
  matched_criteria jsonb DEFAULT '{}'::jsonb,
  ignored_criteria jsonb DEFAULT '[]'::jsonb,
  components jsonb DEFAULT '{}'::jsonb,
  base_value numeric DEFAULT 0,
  final_value numeric DEFAULT 0,
  is_override boolean DEFAULT false,
  override_reason text,
  override_by uuid,
  fallback_used boolean DEFAULT false,
  fallback_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.freight_calculation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view freight_calculation_log"
  ON public.freight_calculation_log
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage freight_calculation_log"
  ON public.freight_calculation_log
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- =============================================
-- 5. receivables — contas a receber
-- =============================================
CREATE TABLE IF NOT EXISTS public.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  order_id uuid,
  fiscal_document_id uuid,
  load_id uuid,
  client_id uuid,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending, invoiced, received, cancelled
  due_date date,
  received_at timestamptz,
  received_amount numeric DEFAULT 0,
  invoice_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view receivables"
  ON public.receivables
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage receivables"
  ON public.receivables
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- =============================================
-- 6. operational_routes — rotas operacionais (NÃO telemáticas)
-- =============================================
CREATE TABLE IF NOT EXISTS public.operational_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  classification text DEFAULT 'general', -- municipal, neighborhood, general
  destinations jsonb DEFAULT '[]'::jsonb,
  region_name text,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

ALTER TABLE public.operational_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view operational_routes"
  ON public.operational_routes
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage operational_routes"
  ON public.operational_routes
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- =============================================
-- 7. route_planning_drafts — rascunhos de roteirização
-- =============================================
CREATE TABLE IF NOT EXISTS public.route_planning_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  order_ids jsonb DEFAULT '[]'::jsonb,
  vehicle_id uuid,
  operational_route_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'draft', -- draft, converted
  converted_load_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.route_planning_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view route_planning_drafts"
  ON public.route_planning_drafts
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage route_planning_drafts"
  ON public.route_planning_drafts
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));
