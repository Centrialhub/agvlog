
-- Phase 2: SSX Integration tables

-- Integration accounts (SSX credentials per tenant)
CREATE TABLE public.integration_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'SSX',
  base_url TEXT NOT NULL DEFAULT 'https://integration.systemsatx.com.br',
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  hashauth TEXT,
  hashcode TEXT,
  token_cache TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('ok','degraded','invalid_credentials','pending')),
  settings JSONB NOT NULL DEFAULT '{"poll_interval_seconds": 300, "max_units_per_batch": 50, "api_version": "v3"}',
  last_login_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_accounts_tenant ON public.integration_accounts(tenant_id);

-- Provider units (tracked units from SSX)
CREATE TABLE public.provider_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_account_id UUID NOT NULL REFERENCES public.integration_accounts(id) ON DELETE CASCADE,
  external_code TEXT NOT NULL,
  external_id TEXT,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_units_tenant ON public.provider_units(tenant_id);
CREATE INDEX idx_provider_units_integration ON public.provider_units(integration_account_id);
CREATE UNIQUE INDEX idx_provider_units_unique ON public.provider_units(tenant_id, integration_account_id, external_code);

-- Vehicle-tracker links
CREATE TABLE public.vehicle_tracker_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  provider_unit_id UUID NOT NULL REFERENCES public.provider_units(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vtl_tenant ON public.vehicle_tracker_links(tenant_id);
CREATE INDEX idx_vtl_vehicle ON public.vehicle_tracker_links(vehicle_id);

-- Telemetry catalog (global per provider)
CREATE TABLE public.telemetry_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'SSX',
  telemetry_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  unit TEXT,
  data_type TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, telemetry_id)
);

-- Telemetry mapping (per tenant, canonical)
CREATE TABLE public.telemetry_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'SSX',
  telemetry_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  transform JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider, telemetry_id)
);

CREATE INDEX idx_telemetry_mapping_tenant ON public.telemetry_mapping(tenant_id);

-- Integration logs (observability)
CREATE TABLE public.integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_account_id UUID REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  endpoint TEXT,
  status_code INT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_logs_tenant ON public.integration_logs(tenant_id, created_at DESC);
CREATE INDEX idx_integration_logs_account ON public.integration_logs(integration_account_id, created_at DESC);

-- RLS policies

ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view integration accounts" ON public.integration_accounts
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY "Admins can insert integration accounts" ON public.integration_accounts
  FOR INSERT WITH CHECK (public.is_tenant_admin(tenant_id));
CREATE POLICY "Admins can update integration accounts" ON public.integration_accounts
  FOR UPDATE USING (public.is_tenant_admin(tenant_id));
CREATE POLICY "Admins can delete integration accounts" ON public.integration_accounts
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

ALTER TABLE public.provider_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view provider units" ON public.provider_units
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY "Admins can manage provider units" ON public.provider_units
  FOR ALL USING (public.is_tenant_admin(tenant_id));

ALTER TABLE public.vehicle_tracker_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view tracker links" ON public.vehicle_tracker_links
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY "Admins can manage tracker links" ON public.vehicle_tracker_links
  FOR ALL USING (public.is_tenant_admin(tenant_id));

ALTER TABLE public.telemetry_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view telemetry catalog" ON public.telemetry_catalog
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.telemetry_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view telemetry mapping" ON public.telemetry_mapping
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
CREATE POLICY "Admins can manage telemetry mapping" ON public.telemetry_mapping
  FOR ALL USING (public.is_tenant_admin(tenant_id));

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view integration logs" ON public.integration_logs
  FOR SELECT USING (tenant_id IN (SELECT public.get_user_tenant_ids()));
