create table finance_private.maintenance_order_sequences(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  next_number bigint not null default 1 check(next_number > 0)
);
revoke all on finance_private.maintenance_order_sequences from public, anon, authenticated, service_role;

with duplicates as (
  select id, tenant_id, order_number, row_number() over(partition by tenant_id, order_number order by created_at, id) position
  from public.maintenance_orders
)
update public.maintenance_orders target
set order_number = target.order_number || '-' || left(target.id::text, 8)
from duplicates duplicate
where target.id = duplicate.id and duplicate.position > 1;
create unique index maintenance_orders_tenant_number_uidx on public.maintenance_orders(tenant_id, order_number);

create function finance_private.next_maintenance_order_number(_tenant_id uuid)
returns text language plpgsql security definer set search_path = '' as $fn$
declare value bigint;
begin
  insert into finance_private.maintenance_order_sequences(tenant_id,next_number) values(_tenant_id,2)
  on conflict(tenant_id) do update set next_number = finance_private.maintenance_order_sequences.next_number + 1
  returning next_number - 1 into value;
  return 'OS-' || extract(year from current_date)::integer::text || '-' || lpad(value::text, 6, '0');
end
$fn$;
revoke all on function finance_private.next_maintenance_order_number(uuid) from public, anon, authenticated, service_role;

create function public.tg_prepare_maintenance_order()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.vehicle_id is not null and not exists(select 1 from public.vehicles x where x.id=new.vehicle_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_order_vehicle_not_found_in_tenant' using errcode='23503'; end if;
  if new.asset_id is not null and not exists(select 1 from public.assets x where x.id=new.asset_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_order_asset_not_found_in_tenant' using errcode='23503'; end if;
  if new.responsible_employee_id is not null and not exists(select 1 from public.employees x where x.id=new.responsible_employee_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_order_employee_not_found_in_tenant' using errcode='23503'; end if;
  if new.incident_id is not null and not exists(select 1 from public.incidents x where x.id=new.incident_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_order_incident_not_found_in_tenant' using errcode='23503'; end if;
  if new.schedule_id is not null and not exists(select 1 from public.maintenance_schedules x where x.id=new.schedule_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_order_schedule_not_found_in_tenant' using errcode='23503'; end if;
  if tg_op='INSERT' then new.order_number := finance_private.next_maintenance_order_number(new.tenant_id); else new.order_number := old.order_number; end if;
  return new;
end
$fn$;

create function public.tg_validate_maintenance_part_refs()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if not exists(select 1 from public.maintenance_orders x where x.id=new.maintenance_order_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_part_order_not_found_in_tenant' using errcode='23503'; end if;
  if new.stock_item_id is not null and not exists(select 1 from public.stock_items x where x.id=new.stock_item_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_part_stock_item_not_found_in_tenant' using errcode='23503'; end if;
  if new.stock_movement_id is not null and not exists(select 1 from public.stock_movements x where x.id=new.stock_movement_id and x.tenant_id=new.tenant_id) then raise exception 'maintenance_part_stock_movement_not_found_in_tenant' using errcode='23503'; end if;
  return new;
end
$fn$;

revoke all on function public.tg_prepare_maintenance_order(), public.tg_validate_maintenance_part_refs() from public, anon, authenticated, service_role;
create trigger prepare_maintenance_order before insert or update of tenant_id, order_number, vehicle_id, asset_id, responsible_employee_id, incident_id, schedule_id
  on public.maintenance_orders for each row execute function public.tg_prepare_maintenance_order();
create trigger validate_maintenance_part_refs before insert or update of tenant_id, maintenance_order_id, stock_item_id, stock_movement_id
  on public.maintenance_parts for each row execute function public.tg_validate_maintenance_part_refs();
