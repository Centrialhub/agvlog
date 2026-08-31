-- Targeted SECURITY DEFINER hardening. Each signature below was classified as
-- legacy, replaced, backend-only, or orphaned after a repository-wide caller
-- audit. Keep service_role access where it already exists, but remove every
-- browser-visible path (including privileges inherited from PUBLIC).

revoke all privileges on function public.assign_fiscal_documents_to_load(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all privileges on function public.remove_fiscal_documents_from_load(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all privileges on function public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

revoke all privileges on function public.audit_data_consistency_v4(uuid) from public, anon, authenticated;
revoke all privileges on function public.audit_operational_congruence_v1(uuid) from public, anon, authenticated;
-- Control Tower still consumes get_active_trips_live/get_open_trip_alerts.
-- Their dedicated migration changes them to guarded SECURITY INVOKER readers.
revoke all privileges on function public.get_driver_workspace_v1(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.get_operational_financial_summary_v1(uuid, date, date) from public, anon, authenticated;
revoke all privileges on function public.log_operational_event_v2(uuid, text, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;

revoke all privileges on function public.create_load_with_next_number(uuid, text, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all privileges on function public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamp with time zone, text) from public, anon, authenticated;
revoke all privileges on function public.update_load_v1(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all privileges on function public.delete_load_v1(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.delete_load_item_v1(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.delete_load_item_v2(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.upsert_load_item_v2(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
revoke all privileges on function public.move_load_items_v3(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
-- plan_dispatch_trip_v3 remains the supported route-planning API. Its
-- authenticated execution is covered by the operational database tests.

revoke all privileges on function public.create_employee_v1(uuid, jsonb) from public, anon, authenticated;
revoke all privileges on function public.update_employee_v1(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all privileges on function public.delete_employee_v1(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.list_employees_v1(uuid, text, text, integer, integer) from public, anon, authenticated;

revoke all privileges on function public.check_resource_ownership(uuid, uuid, text) from public, anon, authenticated;
revoke all privileges on function public.commit_load_import_v1(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all privileges on function public.execute_data_repair_v1(uuid, uuid, boolean) from public, anon, authenticated;
revoke all privileges on function public.execute_data_repair_v1(uuid, uuid) from public, anon, authenticated;
revoke all privileges on function public.handle_new_user() from public, anon, authenticated;

comment on function public.assign_fiscal_documents_to_load(uuid, uuid, uuid[]) is
  'Legacy browser RPC. Use assign_fiscal_documents_to_load_v2.';
comment on function public.remove_fiscal_documents_from_load(uuid, uuid, uuid[]) is
  'Legacy browser RPC. Use remove_fiscal_documents_from_load_v2.';
comment on function public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) is
  'Legacy browser RPC. Driver events use the scoped canonical driver RPCs.';
