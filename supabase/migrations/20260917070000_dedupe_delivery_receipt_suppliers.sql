alter function public.get_delivery_receipt_filter_catalog_v1(uuid)
  rename to get_delivery_receipt_filter_catalog_raw_20260917;
revoke all on function public.get_delivery_receipt_filter_catalog_raw_20260917(uuid)
  from public, anon, authenticated, service_role;

create function public.get_delivery_receipt_filter_catalog_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare payload jsonb; suppliers jsonb;
begin
  payload := public.get_delivery_receipt_filter_catalog_raw_20260917(_tenant_id);
  select coalesce(jsonb_agg(jsonb_build_object('value', value, 'label', label) order by label, value), '[]'::jsonb)
  into suppliers
  from (
    select option->>'value' value, min(option->>'label') label
    from jsonb_array_elements(payload->'suppliers') option
    group by option->>'value'
  ) deduplicated;
  return jsonb_set(payload, '{suppliers}', suppliers, false);
end
$fn$;

revoke all on function public.get_delivery_receipt_filter_catalog_v1(uuid) from public, anon;
grant execute on function public.get_delivery_receipt_filter_catalog_v1(uuid) to authenticated;
