
-- ============================================
-- PHASE 1: LOGISTICS DOMAIN TABLES
-- ============================================

-- 1. CLIENTS
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  company_name text NOT NULL,
  legal_name text,
  tax_id text,
  contacts jsonb DEFAULT '[]'::jsonb,
  addresses jsonb DEFAULT '[]'::jsonb,
  service_notes text,
  payment_notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX idx_clients_tenant ON public.clients(tenant_id);
CREATE INDEX idx_clients_tax_id ON public.clients(tenant_id, tax_id);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view clients" ON public.clients
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage clients" ON public.clients
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 2. ORDERS
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  order_number text NOT NULL,
  client_id uuid REFERENCES public.clients(id),
  promised_date date,
  origin text,
  destination text,
  cargo_type text,
  quantity numeric,
  pallet_count integer DEFAULT 0,
  weight_kg numeric,
  volume_m3 numeric,
  notes text,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX idx_orders_tenant ON public.orders(tenant_id);
CREATE INDEX idx_orders_client ON public.orders(client_id);
CREATE INDEX idx_orders_status ON public.orders(tenant_id, status);
CREATE UNIQUE INDEX idx_orders_number ON public.orders(tenant_id, order_number);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view orders" ON public.orders
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage orders" ON public.orders
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 3. FISCAL DOCUMENTS
CREATE TABLE public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  document_type text NOT NULL DEFAULT 'inbound',
  invoice_number text,
  access_key text,
  client_id uuid REFERENCES public.clients(id),
  remitter text,
  recipient text,
  issue_date date,
  order_id uuid REFERENCES public.orders(id),
  load_id uuid,
  product_summary text,
  pallet_count integer DEFAULT 0,
  weight_kg numeric,
  value numeric,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_fiscal_docs_tenant ON public.fiscal_documents(tenant_id);
CREATE INDEX idx_fiscal_docs_client ON public.fiscal_documents(client_id);
CREATE INDEX idx_fiscal_docs_order ON public.fiscal_documents(order_id);

ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view fiscal_documents" ON public.fiscal_documents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage fiscal_documents" ON public.fiscal_documents
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 4. INVENTORY LOCATIONS
CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  code text,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_locations_tenant ON public.inventory_locations(tenant_id);

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory_locations" ON public.inventory_locations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage inventory_locations" ON public.inventory_locations
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 5. INVENTORY MOVEMENTS
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  location_id uuid REFERENCES public.inventory_locations(id),
  movement_type text NOT NULL DEFAULT 'inbound',
  client_id uuid REFERENCES public.clients(id),
  item_description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  pallet_count integer DEFAULT 0,
  weight_kg numeric,
  volume_m3 numeric,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id),
  notes text,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_inv_movements_tenant ON public.inventory_movements(tenant_id);
CREATE INDEX idx_inv_movements_location ON public.inventory_movements(location_id);
CREATE INDEX idx_inv_movements_client ON public.inventory_movements(client_id);
CREATE INDEX idx_inv_movements_type ON public.inventory_movements(tenant_id, movement_type);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory_movements" ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage inventory_movements" ON public.inventory_movements
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 6. INVENTORY BALANCES (materialized by movements)
CREATE TABLE public.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  location_id uuid REFERENCES public.inventory_locations(id),
  client_id uuid REFERENCES public.clients(id),
  item_description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  pallet_count integer NOT NULL DEFAULT 0,
  weight_kg numeric DEFAULT 0,
  volume_m3 numeric DEFAULT 0,
  first_inbound_at timestamptz,
  last_movement_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, location_id, client_id, item_description)
);

CREATE INDEX idx_inv_balances_tenant ON public.inventory_balances(tenant_id);
CREATE INDEX idx_inv_balances_client ON public.inventory_balances(client_id);
CREATE INDEX idx_inv_balances_location ON public.inventory_balances(location_id);

ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory_balances" ON public.inventory_balances
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage inventory_balances" ON public.inventory_balances
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 7. LOADS
CREATE TABLE public.loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_number text NOT NULL,
  vehicle_id uuid REFERENCES public.vehicles(id),
  driver_id uuid REFERENCES public.drivers(id),
  origin text,
  destination text,
  total_pallet_count integer DEFAULT 0,
  total_weight_kg numeric DEFAULT 0,
  total_volume_m3 numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'planned',
  trip_id uuid REFERENCES public.trips(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_loads_tenant ON public.loads(tenant_id);
CREATE INDEX idx_loads_vehicle ON public.loads(vehicle_id);
CREATE INDEX idx_loads_status ON public.loads(tenant_id, status);
CREATE UNIQUE INDEX idx_loads_number ON public.loads(tenant_id, load_number);

ALTER TABLE public.loads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view loads" ON public.loads
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage loads" ON public.loads
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- Add load_id FK to fiscal_documents now that loads table exists
ALTER TABLE public.fiscal_documents
  ADD CONSTRAINT fiscal_documents_load_id_fkey
  FOREIGN KEY (load_id) REFERENCES public.loads(id);

-- 8. LOAD_ORDERS (join table)
CREATE TABLE public.load_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(load_id, order_id)
);

ALTER TABLE public.load_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view load_orders" ON public.load_orders
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage load_orders" ON public.load_orders
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 9. LOAD_DOCUMENTS (join table)
CREATE TABLE public.load_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  fiscal_document_id uuid NOT NULL REFERENCES public.fiscal_documents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(load_id, fiscal_document_id)
);

ALTER TABLE public.load_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view load_documents" ON public.load_documents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage load_documents" ON public.load_documents
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

-- 10. EXTEND VEHICLES with capacity fields
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS max_pallets integer,
  ADD COLUMN IF NOT EXISTS max_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS max_volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS body_type text,
  ADD COLUMN IF NOT EXISTS base_consumption_estimate numeric,
  ADD COLUMN IF NOT EXISTS loaded_consumption_factor numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS expected_speed_penalty_loaded numeric DEFAULT 0;
