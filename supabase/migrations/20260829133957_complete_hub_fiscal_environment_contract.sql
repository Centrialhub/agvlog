-- Keep the frontend, credential vault and proxy on the same FiscalHub contract.
alter table public.hub_fiscal_credentials
  drop constraint if exists hub_fiscal_credentials_doc_scope_check,
  drop constraint if exists hub_fiscal_credentials_environment_check;

alter table public.hub_fiscal_credentials
  add constraint hub_fiscal_credentials_doc_scope_check
    check (doc_scope = any (array['all', 'nfse', 'cte', 'nfe', 'nfce', 'mdfe', 'nfcom']::text[])),
  add constraint hub_fiscal_credentials_environment_check
    check (environment = any (array['sandbox', 'homologation', 'production']::text[]));

comment on column public.hub_fiscal_credentials.doc_scope is
  'FiscalHub document scope: all, nfse, cte, nfe, nfce, mdfe or nfcom.';
comment on column public.hub_fiscal_credentials.environment is
  'FiscalHub credential environment: sandbox, homologation or production.';
