create table public.physical_journeys(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workspace_person_id uuid references public.workspace_people(id) on delete restrict,
  workspace_vehicle_id uuid references public.workspace_vehicles(id) on delete restrict,
  status text not null default 'planned' check(status in('planned','active','completed','cancelled')),
  planned_start_at timestamptz,
  actual_start_at timestamptz,
  planned_end_at timestamptz,
  actual_end_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.physical_journey_trips(
  physical_journey_id uuid not null references public.physical_journeys(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_trip_id uuid not null unique references public.dispatch_trips(id) on delete cascade,
  trip_order integer not null default 1 check(trip_order>0),
  created_at timestamptz not null default now(),
  primary key(physical_journey_id,dispatch_trip_id)
);

create table public.physical_journey_stops(
  physical_journey_id uuid not null references public.physical_journeys(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_stop_id uuid not null unique references public.dispatch_stops(id) on delete cascade,
  journey_order integer not null check(journey_order>0),
  created_at timestamptz not null default now(),
  primary key(physical_journey_id,dispatch_stop_id)
);

create index physical_journeys_driver_active_idx on public.physical_journeys(workspace_person_id,status,created_at desc);
create index physical_journey_trips_workspace_idx on public.physical_journey_trips(workspace_id,source_tenant_id);
create index physical_journey_stops_order_idx on public.physical_journey_stops(physical_journey_id,journey_order);

insert into public.physical_journeys(
  id,workspace_id,workspace_person_id,workspace_vehicle_id,status,
  planned_start_at,actual_start_at,planned_end_at,actual_end_at,created_at,updated_at
)
select dt.id,t.workspace_id,person.workspace_person_id,vehicle.workspace_vehicle_id,
  case when dt.status='cancelled' then 'cancelled' when dt.status='completed' then 'completed'
       when dt.actual_start_at is not null then 'active' else 'planned' end,
  dt.planned_start_at,dt.actual_start_at,dt.planned_end_at,dt.actual_end_at,dt.created_at,dt.updated_at
from public.dispatch_trips dt
join public.tenants t on t.id=dt.tenant_id
left join public.workspace_person_tenant_links person
  on person.tenant_id=dt.tenant_id and person.driver_id=dt.driver_id
left join public.workspace_vehicle_tenant_links vehicle
  on vehicle.tenant_id=dt.tenant_id and vehicle.vehicle_id=dt.vehicle_id;

insert into public.physical_journey_trips(physical_journey_id,workspace_id,source_tenant_id,dispatch_trip_id)
select dt.id,t.workspace_id,dt.tenant_id,dt.id
from public.dispatch_trips dt join public.tenants t on t.id=dt.tenant_id;

insert into public.physical_journey_stops(physical_journey_id,workspace_id,source_tenant_id,dispatch_stop_id,journey_order)
select dt.id,t.workspace_id,ds.tenant_id,ds.id,ds.stop_order
from public.dispatch_stops ds
join public.dispatch_trips dt on dt.id=ds.dispatch_trip_id and dt.tenant_id=ds.tenant_id
join public.tenants t on t.id=ds.tenant_id;

create or replace function private.create_physical_journey_for_trip()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_workspace uuid;v_person uuid;v_vehicle uuid;
begin
  select t.workspace_id into v_workspace from public.tenants t where t.id=new.tenant_id;
  select link.workspace_person_id into v_person from public.workspace_person_tenant_links link where link.tenant_id=new.tenant_id and link.driver_id=new.driver_id;
  select link.workspace_vehicle_id into v_vehicle from public.workspace_vehicle_tenant_links link where link.tenant_id=new.tenant_id and link.vehicle_id=new.vehicle_id;
  insert into public.physical_journeys(id,workspace_id,workspace_person_id,workspace_vehicle_id,status,planned_start_at,actual_start_at,planned_end_at,actual_end_at,created_at,updated_at)
  values(new.id,v_workspace,v_person,v_vehicle,case when new.status='cancelled' then 'cancelled' when new.status='completed' then 'completed' when new.actual_start_at is not null then 'active' else 'planned' end,new.planned_start_at,new.actual_start_at,new.planned_end_at,new.actual_end_at,new.created_at,new.updated_at);
  insert into public.physical_journey_trips(physical_journey_id,workspace_id,source_tenant_id,dispatch_trip_id)
  values(new.id,v_workspace,new.tenant_id,new.id);
  return new;
end;$function$;

create or replace function private.attach_physical_journey_stop()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_link public.physical_journey_trips%rowtype;
begin
  select * into v_link from public.physical_journey_trips where dispatch_trip_id=new.dispatch_trip_id;
  if v_link.dispatch_trip_id is null or v_link.source_tenant_id<>new.tenant_id then raise exception 'physical_journey_stop_tenant_mismatch' using errcode='23514';end if;
  insert into public.physical_journey_stops(physical_journey_id,workspace_id,source_tenant_id,dispatch_stop_id,journey_order)
  values(v_link.physical_journey_id,v_link.workspace_id,new.tenant_id,new.id,new.stop_order);
  return new;
end;$function$;

revoke all on function private.create_physical_journey_for_trip(),private.attach_physical_journey_stop() from public,anon,authenticated,service_role;
create trigger dispatch_trips_create_physical_journey after insert on public.dispatch_trips for each row execute function private.create_physical_journey_for_trip();
create trigger dispatch_stops_attach_physical_journey after insert on public.dispatch_stops for each row execute function private.attach_physical_journey_stop();

create or replace function private.can_access_physical_journey(_journey uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(
    select 1 from public.physical_journeys journey
    where journey.id=_journey and (
      exists(select 1 from public.tenant_memberships membership join public.tenants tenant on tenant.id=membership.tenant_id
        where tenant.workspace_id=journey.workspace_id and membership.user_id=auth.uid() and membership.active and membership.role in('owner','admin','operator'))
      or exists(select 1 from public.workspace_person_tenant_links link join public.drivers driver on driver.id=link.driver_id
        where link.workspace_person_id=journey.workspace_person_id and driver.user_id=auth.uid() and driver.active)
    )
  );
$function$;
revoke all on function private.can_access_physical_journey(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_access_physical_journey(uuid) to authenticated,service_role;

alter table public.physical_journeys enable row level security;
alter table public.physical_journey_trips enable row level security;
alter table public.physical_journey_stops enable row level security;
create policy physical_journey_read on public.physical_journeys for select to authenticated using(private.can_access_physical_journey(id));
create policy physical_journey_trip_read on public.physical_journey_trips for select to authenticated using(private.can_access_physical_journey(physical_journey_id));
create policy physical_journey_stop_read on public.physical_journey_stops for select to authenticated using(private.can_access_physical_journey(physical_journey_id));
revoke all on public.physical_journeys,public.physical_journey_trips,public.physical_journey_stops from public,anon,authenticated,service_role;
grant select on public.physical_journeys,public.physical_journey_trips,public.physical_journey_stops to authenticated;
grant all on public.physical_journeys,public.physical_journey_trips,public.physical_journey_stops to service_role;

create or replace function public.merge_physical_journeys_v1(_tenant_id uuid,_trip_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_target uuid;v_count integer;v_distinct_driver integer;v_distinct_vehicle integer;
begin
  if coalesce(array_length(_trip_ids,1),0)<2 then raise exception 'physical_journey_requires_multiple_trips' using errcode='22023';end if;
  if not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant_id and m.user_id=v_actor and m.active and m.role in('owner','admin','operator')) then raise exception 'physical_journey_not_authorized' using errcode='42501';end if;
  select workspace_id into v_workspace from public.tenants where id=_tenant_id;
  select count(*),count(distinct coalesce(person.workspace_person_id,dt.driver_id)),count(distinct coalesce(vehicle.workspace_vehicle_id,dt.vehicle_id))
  into v_count,v_distinct_driver,v_distinct_vehicle
  from public.dispatch_trips dt join public.tenants t on t.id=dt.tenant_id
  left join public.workspace_person_tenant_links person on person.tenant_id=dt.tenant_id and person.driver_id=dt.driver_id
  left join public.workspace_vehicle_tenant_links vehicle on vehicle.tenant_id=dt.tenant_id and vehicle.vehicle_id=dt.vehicle_id
  where dt.id=any(_trip_ids) and t.workspace_id=v_workspace;
  if v_count<>cardinality(_trip_ids) then raise exception 'physical_journey_trip_outside_workspace' using errcode='23514';end if;
  if v_distinct_driver>1 or v_distinct_vehicle>1 then raise exception 'physical_journey_incompatible_resources' using errcode='23514';end if;
  select link.physical_journey_id into v_target from public.physical_journey_trips link where link.dispatch_trip_id=any(_trip_ids) order by link.created_at,link.physical_journey_id limit 1 for update;
  update public.physical_journey_trips set physical_journey_id=v_target,trip_order=array_position(_trip_ids,dispatch_trip_id) where dispatch_trip_id=any(_trip_ids);
  update public.physical_journey_stops stop set physical_journey_id=v_target,journey_order=ordered.position
  from(select ds.id,row_number() over(order by array_position(_trip_ids,ds.dispatch_trip_id),ds.stop_order,ds.id)::integer position from public.dispatch_stops ds where ds.dispatch_trip_id=any(_trip_ids)) ordered
  where stop.dispatch_stop_id=ordered.id;
  delete from public.physical_journeys journey where journey.id<>v_target and not exists(select 1 from public.physical_journey_trips link where link.physical_journey_id=journey.id);
  update public.physical_journeys set status='active',updated_at=now() where id=v_target;
  return v_target;
end;$function$;

create or replace function public.get_current_driver_journey_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_journey public.physical_journeys%rowtype;v_actor uuid:=auth.uid();
begin
  select journey.* into v_journey from public.physical_journeys journey
  where journey.status in('planned','active') and exists(
    select 1 from public.workspace_person_tenant_links link join public.drivers driver on driver.id=link.driver_id
    where link.workspace_person_id=journey.workspace_person_id and driver.user_id=v_actor and driver.active)
  order by case journey.status when 'active' then 0 else 1 end,journey.created_at desc limit 1;
  if v_journey.id is null then return jsonb_build_object('version',1,'has_active_journey',false);end if;
  return jsonb_build_object('version',1,'has_active_journey',true,'journey',to_jsonb(v_journey),
    'trips',(select coalesce(jsonb_agg(jsonb_build_object('trip_id',link.dispatch_trip_id,'tenant_id',link.source_tenant_id,'trip_order',link.trip_order) order by link.trip_order),'[]'::jsonb) from public.physical_journey_trips link where link.physical_journey_id=v_journey.id),
    'stops',(select coalesce(jsonb_agg(jsonb_build_object('stop_id',stop.dispatch_stop_id,'tenant_id',stop.source_tenant_id,'journey_order',stop.journey_order) order by stop.journey_order),'[]'::jsonb) from public.physical_journey_stops stop where stop.physical_journey_id=v_journey.id));
end;$function$;

revoke all on function public.merge_physical_journeys_v1(uuid,uuid[]),public.get_current_driver_journey_v1() from public,anon,authenticated,service_role;
grant execute on function public.merge_physical_journeys_v1(uuid,uuid[]),public.get_current_driver_journey_v1() to authenticated,service_role;

create trigger physical_journeys_set_updated_at before update on public.physical_journeys for each row execute function public.update_updated_at_column();
comment on table public.physical_journeys is 'Shared physical route. Every linked trip and stop retains its source legal tenant.';
