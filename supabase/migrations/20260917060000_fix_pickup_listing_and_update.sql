create or replace function public.update_pickup_order_v1(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  t uuid := nullif(_payload->>'tenant_id', '')::uuid;
  pickup_id uuid := nullif(_payload->>'id', '')::uuid;
  expected_updated_at timestamptz := nullif(_payload->>'expected_updated_at', '')::timestamptz;
  current_row public.pickup_orders%rowtype;
  updated_row public.pickup_orders%rowtype;
  remitter public.clients%rowtype;
  driver_row public.drivers%rowtype;
  vehicle_row public.vehicles%rowtype;
begin
  if auth.uid() is null or t is null or not public.is_tenant_operator_or_admin(t) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if pickup_id is null or expected_updated_at is null then
    raise exception 'pickup_id_and_expected_updated_at_required' using errcode = '22023';
  end if;

  select * into current_row
  from public.pickup_orders
  where id = pickup_id and tenant_id = t
  for update;
  if not found then raise exception 'pickup_order_not_found' using errcode = 'P0002'; end if;
  if current_row.updated_at is distinct from expected_updated_at then
    raise exception 'pickup_order_changed' using errcode = '40001';
  end if;

  perform finance_private.assert_tenant_reference('public.clients', t, nullif(_payload->>'remitter_client_id', '')::uuid, 'remitter_client');
  perform finance_private.assert_tenant_reference('public.drivers', t, nullif(_payload->>'driver_id', '')::uuid, 'driver');
  perform finance_private.assert_tenant_reference('public.vehicles', t, nullif(_payload->>'vehicle_id', '')::uuid, 'vehicle');

  if nullif(_payload->>'remitter_client_id', '') is not null then
    select * into remitter from public.clients where id = (_payload->>'remitter_client_id')::uuid and tenant_id = t;
  end if;
  select * into driver_row from public.drivers where id = (_payload->>'driver_id')::uuid and tenant_id = t;
  select * into vehicle_row from public.vehicles where id = (_payload->>'vehicle_id')::uuid and tenant_id = t;

  update public.pickup_orders
  set remitter_client_id = nullif(_payload->>'remitter_client_id', '')::uuid,
      remitter_name = case when remitter.id is null then null else remitter.company_name end,
      remitter_cnpj = case when remitter.id is null then null else remitter.tax_id end,
      recipient_name = btrim(_payload->>'recipient_name'),
      driver_id = driver_row.id,
      driver_name_snapshot = driver_row.name,
      vehicle_id = vehicle_row.id,
      vehicle_plate_snapshot = vehicle_row.plate,
      pickup_at = (_payload->>'pickup_at')::timestamptz,
      status = _payload->>'status',
      notes = nullif(btrim(_payload->>'notes'), '')
  where id = pickup_id and tenant_id = t
  returning * into updated_row;

  return to_jsonb(updated_row);
end
$fn$;

revoke all on function public.update_pickup_order_v1(jsonb) from public, anon;
grant execute on function public.update_pickup_order_v1(jsonb) to authenticated;
