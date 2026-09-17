create function public.tg_validate_asset_tenant_refs()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.responsible_employee_id is not null and not exists(
    select 1 from public.employees employee where employee.id = new.responsible_employee_id and employee.tenant_id = new.tenant_id
  ) then raise exception 'asset_responsible_not_found_in_tenant' using errcode = '23503'; end if;
  return new;
end
$fn$;

create function public.tg_validate_asset_movement_tenant_refs()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if not exists(select 1 from public.assets asset where asset.id = new.asset_id and asset.tenant_id = new.tenant_id) then
    raise exception 'asset_movement_asset_not_found_in_tenant' using errcode = '23503';
  end if;
  if new.from_employee_id is not null and not exists(select 1 from public.employees employee where employee.id = new.from_employee_id and employee.tenant_id = new.tenant_id) then
    raise exception 'asset_movement_from_employee_not_found_in_tenant' using errcode = '23503';
  end if;
  if new.to_employee_id is not null and not exists(select 1 from public.employees employee where employee.id = new.to_employee_id and employee.tenant_id = new.tenant_id) then
    raise exception 'asset_movement_to_employee_not_found_in_tenant' using errcode = '23503';
  end if;
  return new;
end
$fn$;

revoke all on function public.tg_validate_asset_tenant_refs(), public.tg_validate_asset_movement_tenant_refs() from public, anon, authenticated, service_role;
create trigger validate_asset_tenant_refs before insert or update of tenant_id, responsible_employee_id
  on public.assets for each row execute function public.tg_validate_asset_tenant_refs();
create trigger validate_asset_movement_tenant_refs before insert or update of tenant_id, asset_id, from_employee_id, to_employee_id
  on public.asset_movements for each row execute function public.tg_validate_asset_movement_tenant_refs();
