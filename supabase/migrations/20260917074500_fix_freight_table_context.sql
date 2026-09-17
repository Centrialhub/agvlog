drop index if exists public.uq_freight_tables_context;
create unique index uq_freight_tables_context on public.freight_tables(
  tenant_id,
  coalesce(client_id::text,''), coalesce(payer_group,''), coalesce(payer,''),
  coalesce(origin_state,''), coalesce(origin_municipality,''), coalesce(origin_region,''),
  coalesce(destination_state,''), coalesce(destination_municipality,''), coalesce(destination_region,''),
  coalesce(distribution_type,''), coalesce(route,''), coalesce(cargo_type,''),
  coalesce(vehicle_type,''), coalesce(body_type,''), coalesce(ctrc_type,''),
  coalesce(valid_from,'1900-01-01'::date), coalesce(valid_until,'9999-12-31'::date)
) where blocked = false;

create function public.tg_validate_freight_table_client()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.client_id is not null and not exists(
    select 1 from public.clients client where client.id = new.client_id and client.tenant_id = new.tenant_id
  ) then raise exception 'freight_table_client_not_found_in_tenant' using errcode = '23503'; end if;
  return new;
end
$fn$;
revoke all on function public.tg_validate_freight_table_client() from public, anon, authenticated, service_role;
create trigger validate_freight_table_client before insert or update of tenant_id, client_id
  on public.freight_tables for each row execute function public.tg_validate_freight_table_client();
