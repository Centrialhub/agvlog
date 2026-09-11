set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('public.geofence_events') is null
    or to_regclass('public.geofences') is null
    or to_regclass('public.dispatch_stops') is null
    or to_regclass('public.dispatch_trips') is null
    or to_regclass('public.dispatch_events') is null
    or to_regprocedure('public.stop_terminal_statuses()') is null then
    raise exception 'delivery_geofence_arrival_prerequisites_missing';
  end if;
end;
$preflight$;

create or replace function private.arrive_next_driver_stop_from_delivery_geofence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fence public.geofences%rowtype;
  v_stop public.dispatch_stops%rowtype;
  v_trip public.dispatch_trips%rowtype;
  v_updated integer;
begin
  if new.direction <> 'enter' then return new; end if;
  select * into v_fence from public.geofences
  where id=new.geofence_id and tenant_id=new.tenant_id and enabled
    and scope_kind='delivery' and dispatch_stop_id is not null;
  if not found then return new; end if;

  select * into v_stop from public.dispatch_stops
  where id=v_fence.dispatch_stop_id and tenant_id=new.tenant_id for update;
  if not found or v_stop.status not in ('pending','planned','arriving')
    or v_stop.actual_arrival_at is not null then return new; end if;

  select * into v_trip from public.dispatch_trips
  where id=v_stop.dispatch_trip_id and tenant_id=new.tenant_id for update;
  if not found or v_trip.vehicle_id is distinct from new.vehicle_id
    or v_trip.status not in ('in_transit','in_progress') or v_trip.actual_start_at is null then
    return new;
  end if;

  -- A vehicle may cross a later delivery fence while approaching the next stop.
  -- Only the first unfinished stop in route order can be advanced automatically.
  if exists(
    select 1 from public.dispatch_stops as prior
    where prior.tenant_id=v_stop.tenant_id and prior.dispatch_trip_id=v_stop.dispatch_trip_id
      and prior.stop_order<v_stop.stop_order
      and not (prior.status=any(public.stop_terminal_statuses()))
  ) then return new; end if;

  update public.dispatch_stops set
    status='arrived',actual_arrival_at=coalesce(actual_arrival_at,new.event_at),updated_at=clock_timestamp()
  where id=v_stop.id and tenant_id=v_stop.tenant_id
    and status in ('pending','planned','arriving') and actual_arrival_at is null;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then return new; end if;

  insert into public.dispatch_events(
    tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,event_at,payload,created_by
  ) values (
    v_stop.tenant_id,v_stop.dispatch_trip_id,v_stop.id,'arrival',new.event_at,
    jsonb_build_object(
      'source','tracking_ssx','geofence_verified',true,'automatic',true,
      'geofence_event_id',new.id,'geofence_id',new.geofence_id,
      'vehicle_id',new.vehicle_id,'latitude',new.payload->'lat',
      'longitude',new.payload->'lng','provider_payload_hash',new.payload->'provider_payload_hash'
    ),null
  );
  return new;
end;
$function$;

revoke all on function private.arrive_next_driver_stop_from_delivery_geofence_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists arrive_next_driver_stop_from_delivery_geofence_v1 on public.geofence_events;
create trigger arrive_next_driver_stop_from_delivery_geofence_v1
after insert on public.geofence_events
for each row execute function private.arrive_next_driver_stop_from_delivery_geofence_v1();

comment on function private.arrive_next_driver_stop_from_delivery_geofence_v1() is
  'Idempotently marks only the next unfinished stop as arrived after a confirmed SSX entry into its lifecycle-scoped delivery fence.';

do $postcondition$
begin
  if not exists(
    select 1 from pg_catalog.pg_trigger
    where tgname='arrive_next_driver_stop_from_delivery_geofence_v1' and not tgisinternal
  ) then raise exception 'delivery_geofence_arrival_trigger_missing'; end if;
end;
$postcondition$;
