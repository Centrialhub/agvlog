create index if not exists idx_tenant_feature_policy_updated_by
  on public.tenant_feature_policy (updated_by)
  where updated_by is not null;
