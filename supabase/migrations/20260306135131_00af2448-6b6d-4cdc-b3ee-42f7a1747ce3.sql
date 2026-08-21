
-- Phase 1: Core multi-tenant foundation

-- Enum for membership roles
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'operator', 'client');

-- Tenants table
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan_key TEXT NOT NULL DEFAULT 'free',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant memberships
CREATE TABLE public.tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'operator',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_tenant_memberships_user ON public.tenant_memberships(user_id);
CREATE INDEX idx_tenant_memberships_tenant ON public.tenant_memberships(tenant_id);

-- Vehicles table
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  nickname TEXT,
  type TEXT DEFAULT 'truck',
  active BOOLEAN NOT NULL DEFAULT true,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(tenant_id, plate)
);

CREATE INDEX idx_vehicles_tenant ON public.vehicles(tenant_id);

-- Drivers table
CREATE TABLE public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  doc TEXT,
  phone TEXT,
  provider_person_id TEXT,
  provider_person_sync_status TEXT DEFAULT 'not_synced',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_drivers_tenant ON public.drivers(tenant_id);

-- Vehicle-Driver assignments
CREATE TABLE public.vehicle_driver_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vda_tenant ON public.vehicle_driver_assignments(tenant_id);
CREATE INDEX idx_vda_vehicle ON public.vehicle_driver_assignments(vehicle_id);

-- Tenant feature policy
CREATE TABLE public.tenant_feature_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, feature_key)
);

-- Profiles table for user display info
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper: get tenant IDs for current user
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_memberships
  WHERE user_id = auth.uid() AND active = true;
$$;

-- Helper: check role
CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role = _role
      AND active = true
  );
$$;

-- Helper: check if user is member of tenant
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND active = true
  );
$$;

-- Helper: check admin or owner
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role IN ('owner', 'admin')
      AND active = true
  );
$$;

-- RLS Policies

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- Tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their tenants" ON public.tenants
  FOR SELECT USING (id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can update tenant" ON public.tenants
  FOR UPDATE USING (public.is_tenant_admin(id));

-- Tenant memberships
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view memberships of their tenants" ON public.tenant_memberships
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can manage memberships" ON public.tenant_memberships
  FOR ALL USING (public.is_tenant_admin(tenant_id));

-- Vehicles
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view vehicles" ON public.vehicles
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can manage vehicles" ON public.vehicles
  FOR INSERT WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can update vehicles" ON public.vehicles
  FOR UPDATE USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can delete vehicles" ON public.vehicles
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

-- Drivers
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view drivers" ON public.drivers
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can manage drivers" ON public.drivers
  FOR INSERT WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can update drivers" ON public.drivers
  FOR UPDATE USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can delete drivers" ON public.drivers
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

-- Vehicle driver assignments
ALTER TABLE public.vehicle_driver_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view assignments" ON public.vehicle_driver_assignments
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can manage assignments" ON public.vehicle_driver_assignments
  FOR INSERT WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can update assignments" ON public.vehicle_driver_assignments
  FOR UPDATE USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "Admins can delete assignments" ON public.vehicle_driver_assignments
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

-- Feature policy
ALTER TABLE public.tenant_feature_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view feature policy" ON public.tenant_feature_policy
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "Admins can manage feature policy" ON public.tenant_feature_policy
  FOR ALL USING (public.is_tenant_admin(tenant_id));
