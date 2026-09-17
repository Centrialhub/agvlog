-- Manual settlement creation must include active drivers and vehicles even
-- before either has historical settlement rows. Inactive historical records
-- remain available so existing settlements can still be filtered.

create or replace function public.list_driver_settlement_filter_options(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_drivers jsonb;
  v_vehicles jsonb;
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', driver.id, 'name', driver.name) order by driver.name, driver.id),
    '[]'::jsonb
  )
  into v_drivers
  from public.drivers driver
  where driver.tenant_id = _tenant_id
    and (
      driver.active
      or exists (
        select 1
        from public.driver_settlements settlement
        where settlement.tenant_id = _tenant_id
          and settlement.driver_id = driver.id
      )
    );

  select coalesce(
    jsonb_agg(jsonb_build_object('id', vehicle.id, 'plate', vehicle.plate) order by vehicle.plate, vehicle.id),
    '[]'::jsonb
  )
  into v_vehicles
  from public.vehicles vehicle
  where vehicle.tenant_id = _tenant_id
    and (
      vehicle.active
      or exists (
        select 1
        from public.driver_settlements settlement
        where settlement.tenant_id = _tenant_id
          and settlement.vehicle_id = vehicle.id
      )
    );

  return jsonb_build_object('drivers', v_drivers, 'vehicles', v_vehicles);
end;
$function$;

revoke all on function public.list_driver_settlement_filter_options(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_driver_settlement_filter_options(uuid)
to authenticated, service_role;
