-- The current public-schema RLS policies execute these helpers as the caller.
-- Keep them available until a dedicated migration moves both helpers and policy
-- references to a private schema atomically.
grant execute on function public._driver_client_ids() to authenticated;
grant execute on function public._driver_fiscal_document_ids() to authenticated;
grant execute on function public._driver_load_ids() to authenticated;
grant execute on function public._driver_order_ids() to authenticated;
grant execute on function public._driver_pickup_order_ids() to authenticated;
grant execute on function public._driver_trip_ids() to authenticated;
