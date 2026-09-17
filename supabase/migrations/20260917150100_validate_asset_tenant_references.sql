create unique index if not exists employees_tenant_id_id_uidx
  on public.employees (tenant_id, id);

create unique index if not exists assets_tenant_id_id_uidx
  on public.assets (tenant_id, id);

do $precondition$
declare
  v_asset_responsible bigint;
  v_movement_asset bigint;
  v_movement_from bigint;
  v_movement_to bigint;
begin
  select count(*) into v_asset_responsible
  from public.assets asset
  join public.employees employee on employee.id = asset.responsible_employee_id
  where asset.tenant_id is distinct from employee.tenant_id;

  select count(*) into v_movement_asset
  from public.asset_movements movement
  join public.assets asset on asset.id = movement.asset_id
  where movement.tenant_id is distinct from asset.tenant_id;

  select count(*) into v_movement_from
  from public.asset_movements movement
  join public.employees employee on employee.id = movement.from_employee_id
  where movement.tenant_id is distinct from employee.tenant_id;

  select count(*) into v_movement_to
  from public.asset_movements movement
  join public.employees employee on employee.id = movement.to_employee_id
  where movement.tenant_id is distinct from employee.tenant_id;

  if v_asset_responsible > 0
     or v_movement_asset > 0
     or v_movement_from > 0
     or v_movement_to > 0 then
    raise exception
      'asset_tenant_reconciliation_required: assets/responsible=%, movements/assets=%, movements/from=%, movements/to=%',
      v_asset_responsible, v_movement_asset, v_movement_from, v_movement_to
      using errcode = '23514';
  end if;
end
$precondition$;

alter table public.assets
  add constraint assets_tenant_responsible_employee_fkey
  foreign key (tenant_id, responsible_employee_id)
  references public.employees (tenant_id, id)
  not valid;

alter table public.asset_movements
  add constraint asset_movements_tenant_asset_fkey
  foreign key (tenant_id, asset_id)
  references public.assets (tenant_id, id)
  not valid;

alter table public.asset_movements
  add constraint asset_movements_tenant_from_employee_fkey
  foreign key (tenant_id, from_employee_id)
  references public.employees (tenant_id, id)
  not valid;

alter table public.asset_movements
  add constraint asset_movements_tenant_to_employee_fkey
  foreign key (tenant_id, to_employee_id)
  references public.employees (tenant_id, id)
  not valid;

alter table public.assets
  validate constraint assets_tenant_responsible_employee_fkey;
alter table public.asset_movements
  validate constraint asset_movements_tenant_asset_fkey;
alter table public.asset_movements
  validate constraint asset_movements_tenant_from_employee_fkey;
alter table public.asset_movements
  validate constraint asset_movements_tenant_to_employee_fkey;
