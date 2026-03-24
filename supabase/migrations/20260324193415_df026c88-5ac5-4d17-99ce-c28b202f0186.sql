
-- Add 'driver' role to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'driver';

-- Dispatch trips - operational trip execution model
CREATE TABLE public.dispatch_trips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_id uuid REFERENCES public.loads(id),
  driver_id uuid REFERENCES public.drivers(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  status text NOT NULL DEFAULT 'planned',
  planned_start_at timestamptz,
  actual_start_at timestamptz,
  planned_end_at timestamptz,
  actual_end_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dispatch_trips" ON public.dispatch_trips FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view dispatch_trips" ON public.dispatch_trips FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispatch stops - ordered delivery stops in a dispatch trip
CREATE TABLE public.dispatch_stops (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  dispatch_trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  stop_order integer NOT NULL DEFAULT 0,
  destination text,
  client_id uuid REFERENCES public.clients(id),
  planned_arrival_at timestamptz,
  actual_arrival_at timestamptz,
  actual_departure_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dispatch_stops" ON public.dispatch_stops FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view dispatch_stops" ON public.dispatch_stops FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispatch events - timeline events for operational trips
CREATE TABLE public.dispatch_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  dispatch_trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  dispatch_stop_id uuid REFERENCES public.dispatch_stops(id),
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dispatch_events" ON public.dispatch_events FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view dispatch_events" ON public.dispatch_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Driver expenses - reimbursement flow
CREATE TABLE public.driver_expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  dispatch_trip_id uuid REFERENCES public.dispatch_trips(id),
  driver_id uuid REFERENCES public.drivers(id),
  category text NOT NULL DEFAULT 'other',
  amount numeric NOT NULL DEFAULT 0,
  expense_at timestamptz NOT NULL DEFAULT now(),
  receipt_url text,
  notes text,
  approval_status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage driver_expenses" ON public.driver_expenses FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view driver_expenses" ON public.driver_expenses FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Authenticated users can view receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');
