drop policy if exists "Admins can manage inventory_movements" on public.inventory_movements;
drop policy if exists "Admins can create inventory_movements" on public.inventory_movements;
create policy "Admins can create inventory_movements"
on public.inventory_movements
as permissive
for insert
to authenticated
with check(public.is_tenant_admin(tenant_id));

revoke update,delete on table public.inventory_movements from authenticated;

create or replace function public.guard_inventory_movement_history()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  raise exception 'inventory_movement_history_is_immutable' using errcode='55000';
end;
$function$;
revoke all on function public.guard_inventory_movement_history()
from public,anon,authenticated,service_role;

drop trigger if exists guard_inventory_movement_history on public.inventory_movements;
create trigger guard_inventory_movement_history
before update or delete on public.inventory_movements
for each row execute function public.guard_inventory_movement_history();

comment on table public.inventory_movements is
  'Append-only inventory facts. Corrections must be represented by a new adjustment movement so aggregate balances and history remain consistent.';
comment on function public.guard_inventory_movement_history() is
  'Rejects direct update/delete of inventory facts, including privileged writes that bypass RLS.';
