
-- =============================================
-- 1. EMPLOYEES
-- =============================================
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  doc_cpf text,
  doc_rg text,
  role_title text, -- cargo/função
  department text,
  branch text, -- filial/base
  manager_id uuid REFERENCES public.employees(id),
  cost_center text,
  hire_date date,
  termination_date date,
  status text NOT NULL DEFAULT 'active', -- active, inactive, on_leave, terminated
  phone text,
  email text,
  address jsonb DEFAULT '{}',
  cnh_number text,
  cnh_category text,
  cnh_expiry date,
  medical_exam_expiry date,
  driver_id uuid REFERENCES public.drivers(id),
  user_id uuid,
  notes text,
  tags jsonb DEFAULT '[]',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_employees_tenant ON public.employees(tenant_id);
CREATE INDEX idx_employees_status ON public.employees(tenant_id, status);

CREATE POLICY "Admins can manage employees" ON public.employees FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view employees" ON public.employees FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 2. EMPLOYEE DOCUMENTS (CNH, exames, treinamentos)
-- =============================================
CREATE TABLE public.employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  document_type text NOT NULL, -- cnh, medical_exam, training, course, certificate
  document_name text NOT NULL,
  document_number text,
  issue_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'valid', -- valid, expiring, expired
  attachment_url text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_employee_docs_employee ON public.employee_documents(employee_id);
CREATE INDEX idx_employee_docs_expiry ON public.employee_documents(tenant_id, expiry_date);

CREATE POLICY "Admins can manage employee_documents" ON public.employee_documents FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view employee_documents" ON public.employee_documents FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 3. INCIDENTS (ocorrências completas)
-- =============================================
CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  incident_number text NOT NULL,
  incident_type text NOT NULL, -- accident, damage, loss, delay, complaint, violation, theft, other
  category text, -- operational, fleet, hr, safety, customer
  severity text NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  status text NOT NULL DEFAULT 'open', -- open, investigating, action_plan, resolved, closed, cancelled
  title text NOT NULL,
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  sla_deadline timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  -- Origin/source
  origin_type text, -- checklist, delivery, route, monitoring, manual, customer_complaint
  -- Links
  load_id uuid,
  order_id uuid,
  vehicle_id uuid,
  employee_id uuid REFERENCES public.employees(id),
  driver_id uuid,
  client_id uuid,
  asset_id uuid, -- FK added after assets table
  route_id uuid,
  dispatch_trip_id uuid,
  fiscal_document_id uuid,
  -- Analysis
  probable_cause text,
  root_cause text,
  action_plan text,
  conclusion text,
  -- Financials
  estimated_cost numeric DEFAULT 0,
  actual_cost numeric DEFAULT 0,
  insurance_claim boolean DEFAULT false,
  insurance_value numeric DEFAULT 0,
  -- Audit
  opened_by uuid,
  validated_by uuid,
  validated_at timestamptz,
  closed_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_incidents_tenant ON public.incidents(tenant_id);
CREATE INDEX idx_incidents_status ON public.incidents(tenant_id, status);
CREATE INDEX idx_incidents_severity ON public.incidents(tenant_id, severity);
CREATE INDEX idx_incidents_vehicle ON public.incidents(vehicle_id);
CREATE INDEX idx_incidents_employee ON public.incidents(employee_id);

CREATE POLICY "Admins can manage incidents" ON public.incidents FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view incidents" ON public.incidents FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 4. INCIDENT RESPONSIBLE (múltiplos responsáveis)
-- =============================================
CREATE TABLE public.incident_responsible (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id),
  responsibility_type text NOT NULL DEFAULT 'operational', -- operational, patrimonial, financial, disciplinary
  description text,
  acknowledged boolean DEFAULT false,
  acknowledged_at timestamptz,
  final_opinion text, -- parecer final
  cost_assigned numeric DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incident_responsible ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_incident_resp_incident ON public.incident_responsible(incident_id);

CREATE POLICY "Admins can manage incident_responsible" ON public.incident_responsible FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view incident_responsible" ON public.incident_responsible FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 5. INCIDENT ATTACHMENTS
-- =============================================
CREATE TABLE public.incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  file_type text, -- photo, video, document, other
  description text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incident_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage incident_attachments" ON public.incident_attachments FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view incident_attachments" ON public.incident_attachments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 6. ASSETS (patrimônio)
-- =============================================
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_code text NOT NULL, -- código patrimonial
  category text NOT NULL, -- vehicle, implement, equipment, tracker, phone_radio, tool, ppe, other
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'available', -- available, in_use, maintenance, decommissioned, lost
  serial_number text,
  chassis_number text,
  plate text,
  brand text,
  model text,
  year integer,
  -- Ownership
  responsible_employee_id uuid REFERENCES public.employees(id),
  current_location text,
  branch text,
  cost_center text,
  -- Financials
  supplier text,
  acquisition_date date,
  acquisition_cost numeric DEFAULT 0,
  current_value numeric DEFAULT 0,
  depreciation_rate numeric DEFAULT 0,
  -- Links
  vehicle_id uuid, -- FK to vehicles if asset is a vehicle
  -- Docs
  documents jsonb DEFAULT '[]',
  notes text,
  tags jsonb DEFAULT '[]',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_assets_tenant ON public.assets(tenant_id);
CREATE INDEX idx_assets_category ON public.assets(tenant_id, category);
CREATE INDEX idx_assets_status ON public.assets(tenant_id, status);
CREATE INDEX idx_assets_responsible ON public.assets(responsible_employee_id);
CREATE UNIQUE INDEX idx_assets_code_tenant ON public.assets(tenant_id, asset_code);

CREATE POLICY "Admins can manage assets" ON public.assets FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view assets" ON public.assets FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Add FK from incidents to assets
ALTER TABLE public.incidents ADD CONSTRAINT incidents_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);

-- =============================================
-- 7. ASSET MOVEMENTS (histórico de movimentação)
-- =============================================
CREATE TABLE public.asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  movement_type text NOT NULL, -- transfer, loan, return, assignment, decommission
  from_employee_id uuid REFERENCES public.employees(id),
  to_employee_id uuid REFERENCES public.employees(id),
  from_location text,
  to_location text,
  reason text,
  notes text,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.asset_movements ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_asset_movements_asset ON public.asset_movements(asset_id);

CREATE POLICY "Admins can manage asset_movements" ON public.asset_movements FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view asset_movements" ON public.asset_movements FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 8. MAINTENANCE ORDERS (completo)
-- =============================================
CREATE TABLE public.maintenance_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  order_number text NOT NULL,
  asset_id uuid REFERENCES public.assets(id),
  vehicle_id uuid,
  maintenance_type text NOT NULL DEFAULT 'corrective', -- preventive, corrective, predictive, emergency
  status text NOT NULL DEFAULT 'open', -- open, waiting_parts, in_progress, waiting_approval, completed, cancelled
  priority text NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  -- Problem
  reported_problem text,
  diagnosis text,
  -- Dates
  opened_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  -- Meters
  odometer_km numeric,
  horimeter_hours numeric,
  -- Costs
  parts_cost numeric DEFAULT 0,
  labor_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  downtime_hours numeric DEFAULT 0,
  -- People
  supplier_vendor text,
  responsible_employee_id uuid REFERENCES public.employees(id),
  approved_by uuid,
  approved_at timestamptz,
  -- Details
  services_performed text,
  checklist_results jsonb DEFAULT '{}',
  notes text,
  -- Links
  incident_id uuid REFERENCES public.incidents(id),
  schedule_id uuid, -- FK added after schedules table
  -- Audit
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_maint_orders_tenant ON public.maintenance_orders(tenant_id);
CREATE INDEX idx_maint_orders_vehicle ON public.maintenance_orders(vehicle_id);
CREATE INDEX idx_maint_orders_asset ON public.maintenance_orders(asset_id);
CREATE INDEX idx_maint_orders_status ON public.maintenance_orders(tenant_id, status);

CREATE POLICY "Admins can manage maintenance_orders" ON public.maintenance_orders FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view maintenance_orders" ON public.maintenance_orders FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 9. MAINTENANCE PARTS (peças aplicadas)
-- =============================================
CREATE TABLE public.maintenance_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  maintenance_order_id uuid NOT NULL REFERENCES public.maintenance_orders(id) ON DELETE CASCADE,
  stock_item_id uuid, -- FK added after stock_items
  item_description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  stock_movement_id uuid, -- FK added after stock_movements
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage maintenance_parts" ON public.maintenance_parts FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view maintenance_parts" ON public.maintenance_parts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 10. MAINTENANCE SCHEDULES (agenda preventiva)
-- =============================================
CREATE TABLE public.maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid REFERENCES public.assets(id),
  vehicle_id uuid,
  schedule_name text NOT NULL,
  maintenance_type text NOT NULL DEFAULT 'preventive',
  -- Triggers
  interval_km numeric,
  interval_days integer,
  interval_hours numeric, -- horímetro
  last_km numeric,
  last_date date,
  last_hours numeric,
  next_km numeric,
  next_date date,
  next_hours numeric,
  -- Config
  auto_create_order boolean DEFAULT false,
  active boolean DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_maint_schedules_vehicle ON public.maintenance_schedules(vehicle_id);

CREATE POLICY "Admins can manage maintenance_schedules" ON public.maintenance_schedules FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view maintenance_schedules" ON public.maintenance_schedules FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Add FK from maintenance_orders to schedules
ALTER TABLE public.maintenance_orders ADD CONSTRAINT maintenance_orders_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.maintenance_schedules(id);

-- =============================================
-- 11. STOCK ITEMS (cadastro de itens)
-- =============================================
CREATE TABLE public.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general', -- tire, oil, filter, mechanical_part, operational, ppe, other
  unit text NOT NULL DEFAULT 'un', -- un, lt, kg, mt, pc
  min_quantity numeric DEFAULT 0,
  max_quantity numeric,
  current_quantity numeric DEFAULT 0,
  unit_cost numeric DEFAULT 0,
  location text, -- almoxarifado/prateleira
  branch text,
  supplier text,
  active boolean DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_stock_items_tenant ON public.stock_items(tenant_id);
CREATE INDEX idx_stock_items_category ON public.stock_items(tenant_id, category);

CREATE POLICY "Admins can manage stock_items" ON public.stock_items FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view stock_items" ON public.stock_items FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Add FK from maintenance_parts to stock_items
ALTER TABLE public.maintenance_parts ADD CONSTRAINT maintenance_parts_stock_item_id_fkey
  FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id);

-- =============================================
-- 12. STOCK MOVEMENTS (movimentações de estoque)
-- =============================================
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  stock_item_id uuid NOT NULL REFERENCES public.stock_items(id),
  movement_type text NOT NULL, -- inbound, outbound, transfer, reserve, adjustment, consumption
  quantity numeric NOT NULL,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  -- Reason/links
  reason text NOT NULL, -- purchase, maintenance, incident, vehicle_use, adjustment, return, transfer, other
  vehicle_id uuid,
  asset_id uuid REFERENCES public.assets(id),
  maintenance_order_id uuid REFERENCES public.maintenance_orders(id),
  incident_id uuid REFERENCES public.incidents(id),
  employee_id uuid REFERENCES public.employees(id),
  cost_center text,
  -- Location
  from_branch text,
  to_branch text,
  -- Audit
  justification text, -- obrigatório para ajustes
  responsible_employee_id uuid REFERENCES public.employees(id),
  approved_by uuid,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_stock_movements_item ON public.stock_movements(stock_item_id);
CREATE INDEX idx_stock_movements_tenant ON public.stock_movements(tenant_id);
CREATE INDEX idx_stock_movements_vehicle ON public.stock_movements(vehicle_id);
CREATE INDEX idx_stock_movements_maint ON public.stock_movements(maintenance_order_id);

CREATE POLICY "Admins can manage stock_movements" ON public.stock_movements FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view stock_movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Add FK from maintenance_parts to stock_movements
ALTER TABLE public.maintenance_parts ADD CONSTRAINT maintenance_parts_stock_movement_id_fkey
  FOREIGN KEY (stock_movement_id) REFERENCES public.stock_movements(id);

-- =============================================
-- 13. OPERATIONAL CHECKLISTS (templates)
-- =============================================
CREATE TABLE public.operational_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  checklist_type text NOT NULL, -- vehicle_departure, vehicle_return, damage_inspection, equipment, tires, safety, documentation
  items jsonb NOT NULL DEFAULT '[]', -- [{label, required, category}]
  can_generate_incident boolean DEFAULT true,
  can_generate_maintenance boolean DEFAULT true,
  can_block_operation boolean DEFAULT false,
  active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operational_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage operational_checklists" ON public.operational_checklists FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view operational_checklists" ON public.operational_checklists FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 14. CHECKLIST EXECUTIONS
-- =============================================
CREATE TABLE public.checklist_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  checklist_id uuid NOT NULL REFERENCES public.operational_checklists(id),
  vehicle_id uuid,
  employee_id uuid REFERENCES public.employees(id),
  dispatch_trip_id uuid,
  execution_type text, -- pre_trip, post_trip, inspection, ad_hoc
  status text NOT NULL DEFAULT 'completed', -- completed, failed, partial
  checked_items jsonb NOT NULL DEFAULT '[]', -- [{item_label, checked, notes, photo_url}]
  total_items integer DEFAULT 0,
  passed_items integer DEFAULT 0,
  failed_items integer DEFAULT 0,
  -- Generated records
  generated_incident_id uuid REFERENCES public.incidents(id),
  generated_maintenance_id uuid REFERENCES public.maintenance_orders(id),
  blocked_operation boolean DEFAULT false,
  notes text,
  executed_at timestamptz NOT NULL DEFAULT now(),
  executed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.checklist_executions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_checklist_exec_vehicle ON public.checklist_executions(vehicle_id);
CREATE INDEX idx_checklist_exec_employee ON public.checklist_executions(employee_id);

CREATE POLICY "Admins can manage checklist_executions" ON public.checklist_executions FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view checklist_executions" ON public.checklist_executions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 15. FUELING CONSUMPTION ALERTS
-- =============================================
CREATE TABLE public.consumption_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  alert_type text NOT NULL, -- inconsistent_odometer, abnormal_consumption, odometer_regression, high_cost
  severity text NOT NULL DEFAULT 'medium',
  message text NOT NULL,
  related_fueling_id uuid,
  expected_value numeric,
  actual_value numeric,
  deviation_percent numeric,
  status text NOT NULL DEFAULT 'open', -- open, acknowledged, dismissed, resolved
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consumption_alerts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_consumption_alerts_vehicle ON public.consumption_alerts(vehicle_id);

CREATE POLICY "Admins can manage consumption_alerts" ON public.consumption_alerts FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view consumption_alerts" ON public.consumption_alerts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- =============================================
-- 16. Add employee_id to existing tables for accountability
-- =============================================
ALTER TABLE public.vehicle_fueling ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id);
ALTER TABLE public.vehicle_fueling ADD COLUMN IF NOT EXISTS station_address text;
ALTER TABLE public.vehicle_fueling ADD COLUMN IF NOT EXISTS route_trip_id uuid;

ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id);
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id);
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents(id);
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS labor_cost numeric DEFAULT 0;
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS parts_cost numeric DEFAULT 0;
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS downtime_hours numeric DEFAULT 0;
ALTER TABLE public.vehicle_maintenance ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium';
