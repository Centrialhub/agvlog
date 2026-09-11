-- Keep these relations visible to static release gates as RLS-protected. The
-- originating migration applies the same statements dynamically; repeating
-- them is idempotent and intentionally does not broaden browser privileges.
alter table public.finance_cash_period_counts enable row level security;
alter table public.finance_cash_period_count_reversals enable row level security;

revoke all on table public.finance_cash_period_counts
  from public, anon, authenticated, service_role;
revoke all on table public.finance_cash_period_count_reversals
  from public, anon, authenticated, service_role;

grant select on table public.finance_cash_period_counts to authenticated;
grant select on table public.finance_cash_period_count_reversals to authenticated;
