do $precondition$
declare
  v_vehicle bigint;
  v_asset bigint;
  v_employee bigint;
  v_incident bigint;
begin
  select count(*) into v_vehicle
  from public.vehicle_maintenance maintenance
  join public.vehicles vehicle on vehicle.id = maintenance.vehicle_id
  where maintenance.tenant_id is distinct from vehicle.tenant_id;

  select count(*) into v_asset
  from public.vehicle_maintenance maintenance
  join public.assets asset on asset.id = maintenance.asset_id
  where maintenance.tenant_id is distinct from asset.tenant_id;

  select count(*) into v_employee
  from public.vehicle_maintenance maintenance
  join public.employees employee on employee.id = maintenance.employee_id
  where maintenance.tenant_id is distinct from employee.tenant_id;

  select count(*) into v_incident
  from public.vehicle_maintenance maintenance
  join public.incidents incident on incident.id = maintenance.incident_id
  where maintenance.tenant_id is distinct from incident.tenant_id;

  if v_vehicle > 0 or v_asset > 0 or v_employee > 0 or v_incident > 0 then
    raise exception
      'vehicle_maintenance_tenant_reconciliation_required: vehicles=%, assets=%, employees=%, incidents=%',
      v_vehicle, v_asset, v_employee, v_incident
      using errcode = '23514';
  end if;
end
$precondition$;

alter table public.vehicle_maintenance
  add constraint vehicle_maintenance_tenant_vehicle_fkey
  foreign key (tenant_id, vehicle_id)
  references public.vehicles (tenant_id, id)
  not valid;

alter table public.vehicle_maintenance
  add constraint vehicle_maintenance_tenant_asset_fkey
  foreign key (tenant_id, asset_id)
  references public.assets (tenant_id, id)
  not valid;

alter table public.vehicle_maintenance
  add constraint vehicle_maintenance_tenant_employee_fkey
  foreign key (tenant_id, employee_id)
  references public.employees (tenant_id, id)
  not valid;

alter table public.vehicle_maintenance
  add constraint vehicle_maintenance_tenant_incident_fkey
  foreign key (tenant_id, incident_id)
  references public.incidents (tenant_id, id)
  not valid;

alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_tenant_vehicle_fkey;
alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_tenant_asset_fkey;
alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_tenant_employee_fkey;
alter table public.vehicle_maintenance
  validate constraint vehicle_maintenance_tenant_incident_fkey;
