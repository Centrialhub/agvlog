-- Keep tracker accounts, units and vehicles inside the tenant recorded on the row.
-- NOT VALID preserves any historical rows for explicit review while enforcing every
-- new insert/update immediately.

create unique index if not exists integration_accounts_tenant_id_id_uidx
  on public.integration_accounts (tenant_id, id);

create unique index if not exists vehicles_tenant_id_id_uidx
  on public.vehicles (tenant_id, id);

create unique index if not exists provider_units_tenant_id_id_uidx
  on public.provider_units (tenant_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.provider_units'::regclass
      and conname = 'provider_units_tenant_account_fkey'
  ) then
    alter table public.provider_units
      add constraint provider_units_tenant_account_fkey
      foreign key (tenant_id, integration_account_id)
      references public.integration_accounts (tenant_id, id)
      on delete cascade
      not valid;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_tracker_links'::regclass
      and conname = 'vehicle_tracker_links_tenant_vehicle_fkey'
  ) then
    alter table public.vehicle_tracker_links
      add constraint vehicle_tracker_links_tenant_vehicle_fkey
      foreign key (tenant_id, vehicle_id)
      references public.vehicles (tenant_id, id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_tracker_links'::regclass
      and conname = 'vehicle_tracker_links_tenant_unit_fkey'
  ) then
    alter table public.vehicle_tracker_links
      add constraint vehicle_tracker_links_tenant_unit_fkey
      foreign key (tenant_id, provider_unit_id)
      references public.provider_units (tenant_id, id)
      on delete cascade
      not valid;
  end if;
end
$$;
