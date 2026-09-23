update public.stock_items set unit = 'un' where length(btrim(unit)) = 0;

alter table public.stock_items
  add constraint stock_items_unit_not_blank check (length(btrim(unit)) > 0) not valid;
alter table public.stock_items validate constraint stock_items_unit_not_blank;

alter table public.stock_movements add column if not exists unit_snapshot text;
update public.stock_movements movement
set unit_snapshot = item.unit
from public.stock_items item
where item.id = movement.stock_item_id and item.tenant_id = movement.tenant_id
  and movement.unit_snapshot is null;
alter table public.stock_movements alter column unit_snapshot set not null;

create or replace function public.stock_movement_active_item_guard()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_unit text; v_active boolean;
begin
  select unit, active into v_unit, v_active from public.stock_items
  where id = new.stock_item_id and tenant_id = new.tenant_id for share;
  if v_unit is null then raise exception 'stock_item_not_found' using errcode='23503'; end if;
  if v_active is false then raise exception 'stock_item_inactive' using errcode='23514'; end if;
  new.unit_snapshot := v_unit;
  return new;
end;
$function$;

drop trigger if exists stock_movement_active_item_guard on public.stock_movements;
create trigger stock_movement_active_item_guard before insert on public.stock_movements
for each row execute function public.stock_movement_active_item_guard();
