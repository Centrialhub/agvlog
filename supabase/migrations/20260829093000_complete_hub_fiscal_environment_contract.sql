-- Fiscal Hub supports sandbox, homologation and production per request. Keep
-- credentials unique per emitter/scope/environment so the same issuer can
-- safely operate in every environment without overwriting its live token.

ALTER TABLE public.hub_fiscal_credentials
  DROP CONSTRAINT IF EXISTS hub_fiscal_credentials_doc_scope_check,
  ADD CONSTRAINT hub_fiscal_credentials_doc_scope_check
    CHECK (doc_scope = ANY (ARRAY['all', 'nfse', 'cte', 'nfe', 'nfce', 'mdfe', 'nfcom']));

ALTER TABLE public.hub_fiscal_credentials
  DROP CONSTRAINT IF EXISTS hub_fiscal_credentials_environment_check,
  ADD CONSTRAINT hub_fiscal_credentials_environment_check
    CHECK (environment = ANY (ARRAY['sandbox', 'homologation', 'production']));

ALTER TABLE public.hub_fiscal_emissions
  DROP CONSTRAINT IF EXISTS hub_fiscal_emissions_environment_check,
  ADD CONSTRAINT hub_fiscal_emissions_environment_check
    CHECK (environment = ANY (ARRAY['sandbox', 'homologation', 'production']));

DROP INDEX IF EXISTS public.uq_hub_fiscal_credentials_scope;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hub_fiscal_credentials_scope_environment
  ON public.hub_fiscal_credentials (emitter_id, doc_scope, environment);