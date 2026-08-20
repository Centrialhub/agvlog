
-- === 1. Extend clients with rural flags ===
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_rural boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rural_notes text,
  ADD COLUMN IF NOT EXISTS rural_driver_instructions text,
  ADD COLUMN IF NOT EXISTS rural_requires_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rural_contact_name text,
  ADD COLUMN IF NOT EXISTS rural_contact_phone text,
  ADD COLUMN IF NOT EXISTS rural_access_type text,
  ADD COLUMN IF NOT EXISTS rural_delivery_difficulty text,
  ADD COLUMN IF NOT EXISTS rural_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clients_tenant_rural ON public.clients(tenant_id, is_rural);

-- === 2. Rural delivery profiles ===
CREATE TABLE IF NOT EXISTS public.client_rural_delivery_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  related_remitter_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  supplier_name_snapshot text,
  recipient_name_snapshot text,
  city text,
  state text,
  neighborhood text,
  locality text,
  origin_city text,
  origin_state text,
  round_trip_km numeric(10,2),
  access_type text,
  delivery_mode text NOT NULL DEFAULT 'direct',
  requires_contact_before_delivery boolean NOT NULL DEFAULT false,
  contact_name text,
  contact_phone text,
  taxi_required boolean NOT NULL DEFAULT false,
  taxi_contact_name text,
  taxi_contact_phone text,
  taxi_estimated_cost numeric(14,2),
  can_deliver_in_city boolean NOT NULL DEFAULT false,
  city_delivery_instructions text,
  driver_instructions text,
  internal_notes text,
  source_type text NOT NULL DEFAULT 'manual',
  source_reference text,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_rural_delivery_profiles TO authenticated;
GRANT ALL ON public.client_rural_delivery_profiles TO service_role;
ALTER TABLE public.client_rural_delivery_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rural_profiles_select" ON public.client_rural_delivery_profiles
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "rural_profiles_insert" ON public.client_rural_delivery_profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "rural_profiles_update" ON public.client_rural_delivery_profiles
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "rural_profiles_delete" ON public.client_rural_delivery_profiles
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_client ON public.client_rural_delivery_profiles(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_remitter ON public.client_rural_delivery_profiles(tenant_id, related_remitter_id);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_city ON public.client_rural_delivery_profiles(tenant_id, city);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_neighborhood ON public.client_rural_delivery_profiles(tenant_id, neighborhood);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_active ON public.client_rural_delivery_profiles(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_taxi ON public.client_rural_delivery_profiles(tenant_id, taxi_required);
CREATE INDEX IF NOT EXISTS idx_rural_profiles_tenant_contact ON public.client_rural_delivery_profiles(tenant_id, requires_contact_before_delivery);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.tg_rural_profile_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rural_profiles_touch ON public.client_rural_delivery_profiles;
CREATE TRIGGER trg_rural_profiles_touch BEFORE UPDATE ON public.client_rural_delivery_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_rural_profile_touch();

-- === 3. History ===
CREATE TABLE IF NOT EXISTS public.client_rural_delivery_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.client_rural_delivery_profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT, INSERT ON public.client_rural_delivery_profile_history TO authenticated;
GRANT ALL ON public.client_rural_delivery_profile_history TO service_role;
ALTER TABLE public.client_rural_delivery_profile_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rural_history_select" ON public.client_rural_delivery_profile_history
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "rural_history_insert" ON public.client_rural_delivery_profile_history
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_rural_history_profile ON public.client_rural_delivery_profile_history(profile_id, created_at DESC);

-- === 4. Import batches ===
CREATE TABLE IF NOT EXISTS public.rural_delivery_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.rural_delivery_import_batches TO authenticated;
GRANT ALL ON public.rural_delivery_import_batches TO service_role;
ALTER TABLE public.rural_delivery_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rural_batches_select" ON public.rural_delivery_import_batches
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "rural_batches_insert" ON public.rural_delivery_import_batches
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "rural_batches_update" ON public.rural_delivery_import_batches
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_rural_batches_tenant_created ON public.rural_delivery_import_batches(tenant_id, created_at DESC);

-- === 5. Helper ===
CREATE OR REPLACE FUNCTION public.client_is_rural(_client_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
  SELECT COALESCE((SELECT is_rural FROM public.clients WHERE id = _client_id), false);
$$;
