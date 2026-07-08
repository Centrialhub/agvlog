
-- Driver route monitoring module
CREATE TABLE public.driver_route_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid NULL REFERENCES public.vehicles(id) ON DELETE SET NULL,
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  route_id uuid NULL,
  monitor_number text NOT NULL,
  driver_name_snapshot text NULL,
  vehicle_plate_snapshot text NULL,
  planned_route_text text NULL,
  planned_cities jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NULL,
  expected_return_date date NULL,
  return_deadline_days integer NULL,
  actual_returned_at timestamptz NULL,
  total_deliveries integer NOT NULL DEFAULT 0,
  completed_deliveries integer NOT NULL DEFAULT 0,
  remaining_deliveries integer NOT NULL DEFAULT 0,
  current_city text NULL,
  current_state text NULL,
  next_city text NULL,
  next_state text NULL,
  remaining_cities jsonb NOT NULL DEFAULT '[]'::jsonb,
  arrival_forecast_text text NULL,
  arrival_forecast_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active',
  last_update_at timestamptz NULL,
  notes text NULL,
  source_type text NOT NULL DEFAULT 'manual',
  import_batch_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_route_monitors TO authenticated;
GRANT ALL ON public.driver_route_monitors TO service_role;
ALTER TABLE public.driver_route_monitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drm_select" ON public.driver_route_monitors FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "drm_insert" ON public.driver_route_monitors FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "drm_update" ON public.driver_route_monitors FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "drm_delete" ON public.driver_route_monitors FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_drm_tenant_driver ON public.driver_route_monitors(tenant_id, driver_id);
CREATE INDEX idx_drm_tenant_vehicle ON public.driver_route_monitors(tenant_id, vehicle_id);
CREATE INDEX idx_drm_tenant_load ON public.driver_route_monitors(tenant_id, load_id);
CREATE INDEX idx_drm_tenant_status ON public.driver_route_monitors(tenant_id, status);
CREATE INDEX idx_drm_tenant_return ON public.driver_route_monitors(tenant_id, expected_return_date);
CREATE INDEX idx_drm_tenant_last_update ON public.driver_route_monitors(tenant_id, last_update_at);

CREATE TABLE public.driver_route_progress_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  monitor_id uuid NOT NULL REFERENCES public.driver_route_monitors(id) ON DELETE CASCADE,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  update_date date NOT NULL,
  update_time time NULL,
  city text NULL,
  state text NULL,
  deliveries_completed_in_city integer NOT NULL DEFAULT 0,
  city_total_deliveries integer NULL,
  deadline_to_finish text NULL,
  city_finished_at time NULL,
  next_city text NULL,
  next_state text NULL,
  next_city_deliveries integer NULL,
  next_deadline_to_finish text NULL,
  next_city_finished_at time NULL,
  observation text NULL,
  status text NULL,
  source_type text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_route_progress_updates TO authenticated;
GRANT ALL ON public.driver_route_progress_updates TO service_role;
ALTER TABLE public.driver_route_progress_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drpu_select" ON public.driver_route_progress_updates FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "drpu_insert" ON public.driver_route_progress_updates FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "drpu_update" ON public.driver_route_progress_updates FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "drpu_delete" ON public.driver_route_progress_updates FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_drpu_tenant_monitor ON public.driver_route_progress_updates(tenant_id, monitor_id);
CREATE INDEX idx_drpu_tenant_date ON public.driver_route_progress_updates(tenant_id, update_date);
CREATE INDEX idx_drpu_tenant_city ON public.driver_route_progress_updates(tenant_id, city);

CREATE TABLE public.driver_arrival_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  monitor_id uuid NOT NULL REFERENCES public.driver_route_monitors(id) ON DELETE CASCADE,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  forecast_date date NOT NULL,
  forecast_time time NULL,
  current_city text NULL,
  current_state text NULL,
  forecast_text text NULL,
  forecast_arrival_at timestamptz NULL,
  remaining_cities_text text NULL,
  remaining_cities jsonb NOT NULL DEFAULT '[]'::jsonb,
  observation text NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_arrival_forecasts TO authenticated;
GRANT ALL ON public.driver_arrival_forecasts TO service_role;
ALTER TABLE public.driver_arrival_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daf_select" ON public.driver_arrival_forecasts FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "daf_insert" ON public.driver_arrival_forecasts FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "daf_update" ON public.driver_arrival_forecasts FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "daf_delete" ON public.driver_arrival_forecasts FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_daf_tenant_monitor ON public.driver_arrival_forecasts(tenant_id, monitor_id);
CREATE INDEX idx_daf_tenant_date ON public.driver_arrival_forecasts(tenant_id, forecast_date);

CREATE TABLE public.driver_monitoring_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text NULL,
  row_count integer NOT NULL DEFAULT 0,
  imported_monitors integer NOT NULL DEFAULT 0,
  imported_updates integer NOT NULL DEFAULT 0,
  imported_forecasts integer NOT NULL DEFAULT 0,
  duplicated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_monitoring_import_batches TO authenticated;
GRANT ALL ON public.driver_monitoring_import_batches TO service_role;
ALTER TABLE public.driver_monitoring_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmib_select" ON public.driver_monitoring_import_batches FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "dmib_insert" ON public.driver_monitoring_import_batches FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "dmib_update" ON public.driver_monitoring_import_batches FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_dmib_tenant_created ON public.driver_monitoring_import_batches(tenant_id, created_at DESC);

CREATE TABLE public.driver_monitoring_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  monitor_id uuid NOT NULL REFERENCES public.driver_route_monitors(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text NULL,
  old_value text NULL,
  new_value text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT ON public.driver_monitoring_history TO authenticated;
GRANT ALL ON public.driver_monitoring_history TO service_role;
ALTER TABLE public.driver_monitoring_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmh_select" ON public.driver_monitoring_history FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "dmh_insert" ON public.driver_monitoring_history FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE INDEX idx_dmh_tenant_monitor ON public.driver_monitoring_history(tenant_id, monitor_id, created_at DESC);

-- updated_at trigger
CREATE TRIGGER trg_drm_updated_at
BEFORE UPDATE ON public.driver_route_monitors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
