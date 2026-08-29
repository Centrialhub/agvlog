alter function public.driver_can_access_vehicle(uuid) set schema private;
alter function public.driver_owns_stop(uuid) set schema private;

create or replace function private.driver_can_access_vehicle(_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.dispatch_trips dt
    join public.drivers d on d.id = dt.driver_id
    where dt.vehicle_id = _vehicle_id
      and d.user_id = auth.uid()
      and d.active = true
  );
$function$;

create or replace function private.driver_owns_stop(_stop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.dispatch_stops ds
    join public.dispatch_trips dt on dt.id = ds.dispatch_trip_id
    join public.drivers d on d.id = dt.driver_id
    where ds.id = _stop_id
      and d.user_id = auth.uid()
      and d.active = true
  );
$function$;

revoke execute on function private.driver_can_access_vehicle(uuid),
                           private.driver_owns_stop(uuid)
from public, anon;

grant execute on function private.driver_can_access_vehicle(uuid),
                          private.driver_owns_stop(uuid)
to authenticated, service_role;
