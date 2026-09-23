alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status = any(array[
    'received','waiting_stock','picking','ready_for_loading','loading',
    'shipped','delivered','partially_delivered','cancelled'
  ]::text[])
) not valid;

create table if not exists public.order_versions(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  version_at timestamptz not null default now(),
  actor_id uuid,
  old_data jsonb not null,
  new_data jsonb not null,
  constraint order_versions_order_tenant_fkey foreign key(tenant_id,order_id)
    references public.orders(tenant_id,id) on delete cascade
);

create index if not exists order_versions_order_history_idx
  on public.order_versions(tenant_id,order_id,version_at desc,id desc);

alter table public.order_versions enable row level security;
revoke all on public.order_versions from public,anon;
grant select on public.order_versions to authenticated;
drop policy if exists order_versions_select on public.order_versions;
create policy order_versions_select on public.order_versions for select to authenticated
using(public.is_tenant_member(tenant_id));

create or replace function public.audit_order_version_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if old is distinct from new then
    insert into public.order_versions(tenant_id,order_id,actor_id,old_data,new_data)
    values(new.tenant_id,new.id,auth.uid(),to_jsonb(old),to_jsonb(new));
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(new.tenant_id,'order',new.id,'update',to_jsonb(old),to_jsonb(new),auth.uid(),'order_update');
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_order_version_v1 on public.orders;
create trigger audit_order_version_v1 after update on public.orders
for each row execute function public.audit_order_version_v1();
