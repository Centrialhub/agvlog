ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS provider_person_id text,
  ADD COLUMN IF NOT EXISTS provider_person_sync_status text,
  ADD COLUMN IF NOT EXISTS provider_person_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_person_integration_account_id uuid REFERENCES public.integration_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_provider_person_status
  ON public.clients (tenant_id, provider_person_sync_status);