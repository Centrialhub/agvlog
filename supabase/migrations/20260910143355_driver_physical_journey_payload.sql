create or replace function public.get_current_driver_journey_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_journey public.physical_journeys%rowtype;
  v_actor uuid := auth.uid();
begin
  select journey.* into v_journey
  from public.physical_journeys journey
  where journey.status in('planned','active') and exists(
    select 1
    from public.workspace_person_tenant_links link
    join public.drivers driver on driver.id=link.driver_id
    where link.workspace_person_id=journey.workspace_person_id
      and driver.user_id=v_actor and driver.active
  )
  order by case journey.status when 'active' then 0 else 1 end,journey.created_at desc
  limit 1;

  if v_journey.id is null then
    return jsonb_build_object('version',1,'has_active_journey',false,'trips','[]'::jsonb,'stops','[]'::jsonb);
  end if;

  return jsonb_build_object(
    'version',1,
    'has_active_journey',true,
    'journey',to_jsonb(v_journey),
    'driver',(
      select jsonb_build_object('id',driver.id,'tenant_id',driver.tenant_id,'name',driver.name,'active',driver.active)
      from public.workspace_person_tenant_links link
      join public.drivers driver on driver.id=link.driver_id
      where link.workspace_person_id=v_journey.workspace_person_id and driver.user_id=v_actor and driver.active
      order by driver.updated_at desc,driver.id limit 1
    ),
    'trips',(
      select coalesce(jsonb_agg(
        to_jsonb(trip)
        || jsonb_build_object(
          'trip_id',link.dispatch_trip_id,
          'tenant_id',link.source_tenant_id,
          'trip_order',link.trip_order,
          'loads',load_summary.payload,
          'vehicles',case when vehicle.id is null then null else jsonb_build_object('plate',vehicle.plate,'nickname',vehicle.nickname) end
        ) order by link.trip_order,link.dispatch_trip_id
      ),'[]'::jsonb)
      from public.physical_journey_trips link
      join public.dispatch_trips trip on trip.id=link.dispatch_trip_id and trip.tenant_id=link.source_tenant_id
      left join public.vehicles vehicle on vehicle.id=trip.vehicle_id and vehicle.tenant_id=trip.tenant_id
      left join lateral (
        select jsonb_build_object(
          'id',load_row.id,'load_number',load_row.load_number,'origin',load_row.origin,
          'destination',load_row.destination,'status',load_row.status
        ) payload
        from public.dispatch_trip_loads trip_load
        join public.loads load_row on load_row.id=trip_load.load_id and load_row.tenant_id=trip_load.tenant_id
        where trip_load.dispatch_trip_id=trip.id
        order by (trip_load.load_id=trip.load_id) desc,trip_load.created_at,trip_load.id
        limit 1
      ) load_summary on true
      where link.physical_journey_id=v_journey.id
    ),
    'stops',(
      select coalesce(jsonb_agg(
        to_jsonb(dispatch_stop)
        || jsonb_build_object(
          'stop_id',journey_stop.dispatch_stop_id,
          'tenant_id',journey_stop.source_tenant_id,
          'journey_order',journey_stop.journey_order,
          'clients',case when client.id is null then null else jsonb_build_object('company_name',client.company_name) end
        ) order by journey_stop.journey_order,journey_stop.dispatch_stop_id
      ),'[]'::jsonb)
      from public.physical_journey_stops journey_stop
      join public.dispatch_stops dispatch_stop
        on dispatch_stop.id=journey_stop.dispatch_stop_id and dispatch_stop.tenant_id=journey_stop.source_tenant_id
      left join public.clients client on client.id=dispatch_stop.client_id and client.tenant_id=dispatch_stop.tenant_id
      where journey_stop.physical_journey_id=v_journey.id
    )
  );
end;
$function$;

revoke all on function public.get_current_driver_journey_v1()
from public,anon,authenticated,service_role;
grant execute on function public.get_current_driver_journey_v1()
to authenticated,service_role;

comment on function public.get_current_driver_journey_v1() is
  'Returns the authenticated driver physical journey with cross-tenant trip and stop details; every item retains its legal source tenant.';
