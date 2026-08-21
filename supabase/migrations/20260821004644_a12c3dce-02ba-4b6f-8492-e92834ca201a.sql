REVOKE ALL ON FUNCTION public.recalculate_load_totals(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_load_item_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_resource_ownership(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recalculate_load_totals(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_item_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_resource_ownership(uuid, uuid, text) TO authenticated;
