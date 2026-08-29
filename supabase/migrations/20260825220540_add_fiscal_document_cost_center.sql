alter table public.fiscal_documents
  add column if not exists cost_center text;

create index if not exists idx_fiscal_documents_tenant_cost_center
  on public.fiscal_documents (tenant_id, cost_center)
  where cost_center is not null;
