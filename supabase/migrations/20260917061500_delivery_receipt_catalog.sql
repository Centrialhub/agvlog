create or replace function public.get_delivery_receipt_filter_catalog_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_not_authorized' using errcode = '42501';
  end if;

  with active_receipts as (
    select receipt.*
    from public.delivery_receipts receipt
    where receipt.tenant_id = _tenant_id and receipt.is_active
  ), receipt_stops as (
    select receipt.id receipt_id, stop.client_id, client.company_name, client.trade_name,
      client.address_city, client.address_state
    from active_receipts receipt
    left join public.dispatch_stops stop on stop.id = receipt.dispatch_stop_id and stop.tenant_id = receipt.tenant_id
    left join public.clients client on client.id = stop.client_id and client.tenant_id = receipt.tenant_id
  ), load_options as (
    select distinct context.load_id
    from active_receipts receipt
    cross join lateral (
      select trip_load.load_id from public.dispatch_trip_loads trip_load
      where trip_load.tenant_id = receipt.tenant_id and trip_load.dispatch_trip_id = receipt.dispatch_trip_id
      union
      select trip.load_id from public.dispatch_trips trip
      where trip.tenant_id = receipt.tenant_id and trip.id = receipt.dispatch_trip_id and trip.load_id is not null
      union
      select stop_document.load_id from public.dispatch_stop_documents stop_document
      where stop_document.tenant_id = receipt.tenant_id and stop_document.dispatch_stop_id = receipt.dispatch_stop_id
        and stop_document.load_id is not null
    ) context
  ), supplier_options as (
    select distinct reference.supplier_id value,
      coalesce(nullif(btrim(reference.issuer_name), ''), 'Fornecedor sem nome') label
    from active_receipts receipt
    join public.delivery_receipt_documents link on link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id
    join public.delivery_document_references reference on reference.id = link.document_reference_id
    where reference.supplier_id is not null
  )
  select jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', auth.uid(),
    'total', (select count(*)::integer from active_receipts),
    'queues', jsonb_build_object(
      'awaiting_sync', (select count(*)::integer from active_receipts where digital_status = 'pending_upload'),
      'awaiting_validation', (select count(*)::integer from active_receipts where digital_status in ('uploaded', 'pending_validation')),
      'rejected', (select count(*)::integer from active_receipts where digital_status = 'rejected'),
      'validated', (select count(*)::integer from active_receipts where digital_status = 'validated'),
      'physical_pending', (select count(*)::integer from active_receipts where physical_status in ('pending_return', 'missing')),
      'ready_to_send', (select count(*)::integer from active_receipts where digital_status = 'validated' and pdf_path is not null and email_status = 'not_sent'),
      'sent', (select count(*)::integer from active_receipts where email_status in ('sent', 'delivered')),
      'send_failures', (select count(*)::integer from active_receipts where email_status in ('failed', 'bounced'))
    ),
    'drivers', coalesce((select jsonb_agg(jsonb_build_object('value', driver.id, 'label', driver.name) order by driver.name, driver.id)
      from public.drivers driver where driver.tenant_id = _tenant_id and exists(select 1 from active_receipts receipt where receipt.driver_id = driver.id)), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('value', vehicle.id, 'label', vehicle.plate) order by vehicle.plate, vehicle.id)
      from public.vehicles vehicle where vehicle.tenant_id = _tenant_id and exists(select 1 from active_receipts receipt where receipt.vehicle_id = vehicle.id)), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'label', label) order by label, value) from supplier_options), '[]'::jsonb),
    'trips', coalesce((select jsonb_agg(jsonb_build_object('value', trip_id, 'label', 'Viagem ' || left(trip_id::text, 8)) order by trip_id)
      from (select distinct dispatch_trip_id trip_id from active_receipts) trips), '[]'::jsonb),
    'loads', coalesce((select jsonb_agg(jsonb_build_object('value', load_id, 'label', 'Carga ' || left(load_id::text, 8)) order by load_id) from load_options), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('value', client_id, 'label', label) order by label, client_id)
      from (select distinct client_id, coalesce(nullif(trade_name, ''), company_name) label from receipt_stops where client_id is not null) clients), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('value', city, 'label', city) order by city)
      from (select distinct btrim(address_city) city from receipt_stops where nullif(btrim(address_city), '') is not null) cities), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(jsonb_build_object('value', state, 'label', state) order by state)
      from (select distinct upper(btrim(address_state)) state from receipt_stops where nullif(btrim(address_state), '') is not null) states), '[]'::jsonb)
  ) into result;
  return result;
end
$fn$;

revoke all on function public.get_delivery_receipt_filter_catalog_v1(uuid) from public, anon;
grant execute on function public.get_delivery_receipt_filter_catalog_v1(uuid) to authenticated;
