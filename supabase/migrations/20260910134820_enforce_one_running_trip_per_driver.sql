-- Future planned trips may coexist. Only a physically running trip is unique.
do $running_trip_preflight$
declare v_conflict record;
begin
  select tenant_id,driver_id,count(*) count,array_agg(id order by id) trip_ids
  into v_conflict
  from public.dispatch_trips
  where driver_id is not null and status in ('in_transit','in_progress')
  group by tenant_id,driver_id having count(*)>1
  order by tenant_id,driver_id limit 1;
  if found then
    raise exception 'running_trip_conflict tenant=% driver=% trips=%',
      v_conflict.tenant_id,v_conflict.driver_id,v_conflict.trip_ids
      using errcode='23514',hint='Conclua ou cancele a viagem incorreta antes de reaplicar esta migration.';
  end if;
end;
$running_trip_preflight$;

create unique index dispatch_trips_one_running_per_driver_idx
  on public.dispatch_trips(tenant_id,driver_id)
  where driver_id is not null and status in ('in_transit','in_progress');

comment on index public.dispatch_trips_one_running_per_driver_idx is
  'Prevents ambiguous driver context while allowing multiple planned future trips.';
