-- These helpers are referenced by RLS policies and do not need a public Data API
-- endpoint. Policy evaluation continues to work without direct EXECUTE grants.
revoke execute on function public._driver_client_ids() from public, anon, authenticated;
revoke execute on function public._driver_fiscal_document_ids() from public, anon, authenticated;
revoke execute on function public._driver_load_ids() from public, anon, authenticated;
revoke execute on function public._driver_order_ids() from public, anon, authenticated;
revoke execute on function public._driver_pickup_order_ids() from public, anon, authenticated;
revoke execute on function public._driver_trip_ids() from public, anon, authenticated;

-- Legacy overloads lacked a caller/tenant authorization check. Secure overloads
-- with is_tenant_operator_or_admin checks remain available.
revoke execute on function public.plan_dispatch_trip_v2(
  uuid, uuid, uuid, uuid[], timestamptz, text
) from public, anon, authenticated;

revoke execute on function public.upsert_load_item_v1(
  uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid
) from public, anon, authenticated;
