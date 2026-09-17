create or replace function public.tg_validate_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare previous_km numeric; next_km numeric;
begin
  if new.recorded_at > now() then raise exception 'odometer_reading_in_future' using errcode = '22023'; end if;
  if not exists(select 1 from public.vehicles v where v.tenant_id = new.tenant_id and v.id = new.vehicle_id) then
    raise exception 'odometer_vehicle_not_found_in_tenant' using errcode = '23503';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':vehicle-odometer:' || new.vehicle_id::text, 0));
  if tg_op = 'UPDATE' and (old.tenant_id, old.vehicle_id) is distinct from (new.tenant_id, new.vehicle_id) then
    perform pg_advisory_xact_lock(hashtextextended(old.tenant_id::text || ':vehicle-odometer:' || old.vehicle_id::text, 0));
  end if;
  select reading_km into previous_km from public.vehicle_odometer
  where tenant_id = new.tenant_id and vehicle_id = new.vehicle_id and id <> new.id
    and (recorded_at, id) < (new.recorded_at, new.id)
  order by recorded_at desc, id desc limit 1;
  select reading_km into next_km from public.vehicle_odometer
  where tenant_id = new.tenant_id and vehicle_id = new.vehicle_id and id <> new.id
    and (recorded_at, id) > (new.recorded_at, new.id)
  order by recorded_at, id limit 1;
  if previous_km is not null and new.reading_km < previous_km
    or next_km is not null and new.reading_km > next_km then
    raise exception 'odometer_reading_not_monotonic' using errcode = '23514';
  end if;
  return new;
end
$fn$;

create or replace function public.tg_sync_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare old_tenant uuid; old_vehicle uuid; new_tenant uuid; new_vehicle uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_tenant := old.tenant_id; old_vehicle := old.vehicle_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then new_tenant := new.tenant_id; new_vehicle := new.vehicle_id; end if;

  if old_vehicle is not null then
    update public.vehicles vehicle set odometer_km = (
      select reading.reading_km from public.vehicle_odometer reading
      where reading.tenant_id = old_tenant and reading.vehicle_id = old_vehicle
      order by reading.recorded_at desc, reading.id desc limit 1
    ), updated_at = now()
    where vehicle.tenant_id = old_tenant and vehicle.id = old_vehicle;
  end if;
  if new_vehicle is not null and (old_tenant, old_vehicle) is distinct from (new_tenant, new_vehicle) then
    update public.vehicles vehicle set odometer_km = (
      select reading.reading_km from public.vehicle_odometer reading
      where reading.tenant_id = new_tenant and reading.vehicle_id = new_vehicle
      order by reading.recorded_at desc, reading.id desc limit 1
    ), updated_at = now()
    where vehicle.tenant_id = new_tenant and vehicle.id = new_vehicle;
  end if;
  return coalesce(new, old);
end
$fn$;

drop trigger if exists validate_vehicle_odometer on public.vehicle_odometer;
create trigger validate_vehicle_odometer
before insert or update of tenant_id, vehicle_id, reading_km, recorded_at
on public.vehicle_odometer for each row execute function public.tg_validate_vehicle_odometer();

drop trigger if exists sync_vehicle_odometer on public.vehicle_odometer;
create trigger sync_vehicle_odometer
after insert or update of tenant_id, vehicle_id, reading_km, recorded_at or delete
on public.vehicle_odometer for each row execute function public.tg_sync_vehicle_odometer();

revoke all on function public.tg_validate_vehicle_odometer(), public.tg_sync_vehicle_odometer() from public, anon, authenticated, service_role;
