create or replace function public.merge_existing_tenant_workspace_v1(
  _source_tenant_id uuid,
  _target_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source_workspace uuid;
  v_target_workspace uuid;
  v_source_ssx_account uuid;
  v_source_ssx_state text;
  v_ssx_count integer;
  v_tenant_count integer;
begin
  select t.workspace_id into v_source_workspace from public.tenants t where t.id=_source_tenant_id for update;
  select t.workspace_id into v_target_workspace from public.tenants t where t.id=_target_tenant_id for update;
  if v_source_workspace is null or v_target_workspace is null then
    raise exception 'workspace_merge_tenant_not_found' using errcode='P0002';
  end if;
  if v_source_workspace=v_target_workspace then
    return jsonb_build_object('merged',false,'workspace_id',v_target_workspace,'reason','already_merged');
  end if;

  select count(distinct i.id) into v_ssx_count
  from public.integration_accounts i
  where i.workspace_id in(v_source_workspace,v_target_workspace) and lower(i.provider)='ssx';
  if v_ssx_count>1 then
    raise exception 'workspace_merge_ssx_conflict' using errcode='23505',
      detail='Resolve the legacy SSX accounts before merging workspaces.';
  end if;

  select registry.integration_account_id,registry.migration_state
  into v_source_ssx_account,v_source_ssx_state
  from public.workspace_ssx_accounts registry
  where registry.workspace_id=v_source_workspace;

  select count(*) into v_tenant_count from public.tenants where workspace_id=v_source_workspace;

  -- Temporarily detach canonical references while their identities are rebuilt
  -- against the destination workspace.
  update public.physical_journeys journey
  set workspace_person_id=null,workspace_vehicle_id=null,workspace_id=v_target_workspace
  where journey.workspace_id=v_source_workspace;
  update public.physical_journey_trips set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.physical_journey_stops set workspace_id=v_target_workspace where workspace_id=v_source_workspace;

  delete from public.workspace_ssx_accounts where workspace_id=v_source_workspace;
  delete from public.workspace_party_tenant_links where workspace_id=v_source_workspace;
  delete from public.workspace_person_tenant_links where workspace_id=v_source_workspace;
  delete from public.workspace_vehicle_tenant_links where workspace_id=v_source_workspace;
  delete from public.workspace_parties where workspace_id=v_source_workspace;
  delete from public.workspace_people where workspace_id=v_source_workspace;
  delete from public.workspace_vehicles where workspace_id=v_source_workspace;

  update public.tenants set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.clients set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.drivers set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.employees set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.vehicles set workspace_id=v_target_workspace where workspace_id=v_source_workspace;
  update public.integration_accounts set workspace_id=v_target_workspace where workspace_id=v_source_workspace;

  if v_source_ssx_account is not null and not exists(
    select 1 from public.workspace_ssx_accounts where workspace_id=v_target_workspace
  ) then
    insert into public.workspace_ssx_accounts(workspace_id,integration_account_id,migration_state)
    values(v_target_workspace,v_source_ssx_account,v_source_ssx_state);
  end if;

  -- Rebuild canonical identities and materialize any missing projections for
  -- the expanded workspace through the normal synchronization triggers.
  update public.clients set updated_at=updated_at where workspace_id=v_target_workspace;
  update public.drivers set updated_at=updated_at where workspace_id=v_target_workspace;
  update public.employees set updated_at=updated_at where workspace_id=v_target_workspace;
  update public.vehicles set updated_at=updated_at where workspace_id=v_target_workspace;

  update public.physical_journeys journey
  set workspace_person_id=resolved.workspace_person_id,
      workspace_vehicle_id=resolved.workspace_vehicle_id
  from (
    select distinct on(link.physical_journey_id)
      link.physical_journey_id,person.workspace_person_id,vehicle.workspace_vehicle_id
    from public.physical_journey_trips link
    join public.dispatch_trips trip on trip.id=link.dispatch_trip_id
    left join public.workspace_person_tenant_links person
      on person.tenant_id=trip.tenant_id and person.driver_id=trip.driver_id
    left join public.workspace_vehicle_tenant_links vehicle
      on vehicle.tenant_id=trip.tenant_id and vehicle.vehicle_id=trip.vehicle_id
    where link.workspace_id=v_target_workspace
    order by link.physical_journey_id,link.trip_order,link.dispatch_trip_id
  ) resolved
  where journey.id=resolved.physical_journey_id;

  insert into public.workspace_memberships(workspace_id,user_id,role,active,created_at,updated_at)
  select v_target_workspace,m.user_id,
    (array_agg(m.role order by case m.role when 'owner' then 1 when 'admin' then 2 when 'operator' then 3 when 'driver' then 4 else 5 end))[1],
    bool_or(m.active),min(m.created_at),now()
  from public.tenant_memberships m
  join public.tenants t on t.id=m.tenant_id
  where t.workspace_id=v_target_workspace
  group by m.user_id
  on conflict(workspace_id,user_id) do update set
    role=case
      when excluded.role='owner' or public.workspace_memberships.role='owner' then 'owner'::public.app_role
      when excluded.role='admin' or public.workspace_memberships.role='admin' then 'admin'::public.app_role
      when excluded.role='operator' or public.workspace_memberships.role='operator' then 'operator'::public.app_role
      else excluded.role end,
    active=public.workspace_memberships.active or excluded.active,
    updated_at=now();

  delete from public.workspace_memberships where workspace_id=v_source_workspace;
  delete from public.workspaces where id=v_source_workspace;

  return jsonb_build_object(
    'merged',true,'workspace_id',v_target_workspace,
    'source_workspace_id',v_source_workspace,'tenants_moved',v_tenant_count,
    'ssx_account_id',v_source_ssx_account
  );
end;
$function$;

revoke all on function public.merge_existing_tenant_workspace_v1(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.merge_existing_tenant_workspace_v1(uuid,uuid)
to service_role;

comment on function public.merge_existing_tenant_workspace_v1(uuid,uuid) is
  'Service-only deployment operation that atomically merges the source tenant workspace into the target tenant workspace. It refuses ambiguous SSX registrations.';
