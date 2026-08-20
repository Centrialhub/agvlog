
-- Allow storing the Hub Fiscal token directly in the DB (AES-GCM encrypted)
ALTER TABLE public.hub_fiscal_credentials
  ALTER COLUMN secret_name DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS secret_hint text;

-- At least one source must be present when the credential is enabled
ALTER TABLE public.hub_fiscal_credentials
  DROP CONSTRAINT IF EXISTS hub_fiscal_credentials_source_chk;
ALTER TABLE public.hub_fiscal_credentials
  ADD CONSTRAINT hub_fiscal_credentials_source_chk
  CHECK (
    NOT enabled
    OR (secret_ciphertext IS NOT NULL AND length(secret_ciphertext) > 0)
    OR (secret_name IS NOT NULL AND length(secret_name) > 0)
  );
