-- Reassert the static relation boundary after the stock acquisition and
-- consumption tables are created. The earlier migrations also enable RLS in a
-- guarded loop; these explicit statements keep the release audit verifiable.
alter table public.finance_stock_acquisition_links enable row level security;
alter table public.finance_stock_acquisition_reversals enable row level security;
alter table public.finance_stock_acquisition_dependencies enable row level security;
alter table public.finance_stock_consumption_attributions enable row level security;
alter table public.finance_stock_consumption_lines enable row level security;
alter table public.finance_stock_consumption_reversals enable row level security;

revoke all on table public.finance_stock_acquisition_links from public, anon, authenticated, service_role;
revoke all on table public.finance_stock_acquisition_reversals from public, anon, authenticated, service_role;
revoke all on table public.finance_stock_acquisition_dependencies from public, anon, authenticated, service_role;
revoke all on table public.finance_stock_consumption_attributions from public, anon, authenticated, service_role;
revoke all on table public.finance_stock_consumption_lines from public, anon, authenticated, service_role;
revoke all on table public.finance_stock_consumption_reversals from public, anon, authenticated, service_role;

grant select on table public.finance_stock_acquisition_links to authenticated;
grant select on table public.finance_stock_acquisition_reversals to authenticated;
grant select on table public.finance_stock_consumption_attributions to authenticated;
grant select on table public.finance_stock_consumption_lines to authenticated;
grant select on table public.finance_stock_consumption_reversals to authenticated;
