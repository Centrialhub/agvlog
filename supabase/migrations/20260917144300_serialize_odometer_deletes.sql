create or replace function public.tg_validate_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_previous_km numeric;
  v_next_km numeric;
  v_new_lock bigint;
  v_old_lock bigint;
begin
  if tg_op='DELETE' then
    perform pg_advisory_xact_lock(hashtextextended(
      old.tenant_id::text||':vehicle-odometer:'||old.vehicle_id::text,0
    ));
    return old;
  end if;

  if new.recorded_at>now() then
    raise exception 'odometer_reading_in_future' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.vehicles vehicle
    where vehicle.tenant_id=new.tenant_id and vehicle.id=new.vehicle_id
  ) then
    raise exception 'odometer_vehicle_not_found_in_tenant' using errcode='23503';
  end if;

  v_new_lock:=hashtextextended(new.tenant_id::text||':vehicle-odometer:'||new.vehicle_id::text,0);
  if tg_op='UPDATE' and (old.tenant_id,old.vehicle_id) is distinct from (new.tenant_id,new.vehicle_id) then
    v_old_lock:=hashtextextended(old.tenant_id::text||':vehicle-odometer:'||old.vehicle_id::text,0);
    perform pg_advisory_xact_lock(least(v_old_lock,v_new_lock));
    perform pg_advisory_xact_lock(greatest(v_old_lock,v_new_lock));
  else
    perform pg_advisory_xact_lock(v_new_lock);
  end if;

  select reading.reading_km into v_previous_km
  from public.vehicle_odometer reading
  where reading.tenant_id=new.tenant_id
    and reading.vehicle_id=new.vehicle_id
    and reading.id<>new.id
    and (reading.recorded_at,reading.id)<(new.recorded_at,new.id)
  order by reading.recorded_at desc,reading.id desc
  limit 1;

  select reading.reading_km into v_next_km
  from public.vehicle_odometer reading
  where reading.tenant_id=new.tenant_id
    and reading.vehicle_id=new.vehicle_id
    and reading.id<>new.id
    and (reading.recorded_at,reading.id)>(new.recorded_at,new.id)
  order by reading.recorded_at,reading.id
  limit 1;

  if (v_previous_km is not null and new.reading_km<v_previous_km)
    or (v_next_km is not null and new.reading_km>v_next_km) then
    raise exception 'odometer_reading_not_monotonic' using errcode='23514';
  end if;
  return new;
end;
$function$;

create or replace function public.tg_sync_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_old_tenant uuid;
  v_old_vehicle uuid;
  v_new_tenant uuid;
  v_new_vehicle uuid;
  v_old_lock bigint;
  v_new_lock bigint;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_old_tenant:=old.tenant_id;
    v_old_vehicle:=old.vehicle_id;
    v_old_lock:=hashtextextended(v_old_tenant::text||':vehicle-odometer:'||v_old_vehicle::text,0);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_tenant:=new.tenant_id;
    v_new_vehicle:=new.vehicle_id;
    v_new_lock:=hashtextextended(v_new_tenant::text||':vehicle-odometer:'||v_new_vehicle::text,0);
  end if;

  if v_old_lock is not null and v_new_lock is not null and v_old_lock<>v_new_lock then
    perform pg_advisory_xact_lock(least(v_old_lock,v_new_lock));
    perform pg_advisory_xact_lock(greatest(v_old_lock,v_new_lock));
  elsif coalesce(v_old_lock,v_new_lock) is not null then
    perform pg_advisory_xact_lock(coalesce(v_old_lock,v_new_lock));
  end if;

  if v_old_vehicle is not null then
    update public.vehicles vehicle
    set odometer_km=(
      select reading.reading_km
      from public.vehicle_odometer reading
      where reading.tenant_id=v_old_tenant and reading.vehicle_id=v_old_vehicle
      order by reading.recorded_at desc,reading.id desc
      limit 1
    ),updated_at=clock_timestamp()
    where vehicle.tenant_id=v_old_tenant and vehicle.id=v_old_vehicle;
  end if;

  if v_new_vehicle is not null
    and (v_old_tenant,v_old_vehicle) is distinct from (v_new_tenant,v_new_vehicle) then
    update public.vehicles vehicle
    set odometer_km=(
      select reading.reading_km
      from public.vehicle_odometer reading
      where reading.tenant_id=v_new_tenant and reading.vehicle_id=v_new_vehicle
      order by reading.recorded_at desc,reading.id desc
      limit 1
    ),updated_at=clock_timestamp()
    where vehicle.tenant_id=v_new_tenant and vehicle.id=v_new_vehicle;
  end if;

  return coalesce(new,old);
end;
$function$;

drop trigger if exists validate_vehicle_odometer on public.vehicle_odometer;
create trigger validate_vehicle_odometer
before insert or update of tenant_id,vehicle_id,reading_km,recorded_at or delete
on public.vehicle_odometer
for each row execute function public.tg_validate_vehicle_odometer();

drop trigger if exists sync_vehicle_odometer on public.vehicle_odometer;
create trigger sync_vehicle_odometer
after insert or update of tenant_id,vehicle_id,reading_km,recorded_at or delete
on public.vehicle_odometer
for each row execute function public.tg_sync_vehicle_odometer();

revoke all on function public.tg_validate_vehicle_odometer(),public.tg_sync_vehicle_odometer()
from public,anon,authenticated,service_role;

comment on function public.tg_sync_vehicle_odometer() is
  'Serializes every odometer mutation per vehicle, then recalculates the projection after any lock wait.';
