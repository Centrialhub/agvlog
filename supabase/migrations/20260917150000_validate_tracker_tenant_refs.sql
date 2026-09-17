do $validation$
declare
  v_account_mismatches bigint;
  v_vehicle_mismatches bigint;
  v_unit_mismatches bigint;
begin
  select count(*)
  into v_account_mismatches
  from public.provider_units unit
  join public.integration_accounts account
    on account.id = unit.integration_account_id
  where unit.tenant_id is distinct from account.tenant_id;

  select count(*)
  into v_vehicle_mismatches
  from public.vehicle_tracker_links link
  join public.vehicles vehicle
    on vehicle.id = link.vehicle_id
  where link.tenant_id is distinct from vehicle.tenant_id;

  select count(*)
  into v_unit_mismatches
  from public.vehicle_tracker_links link
  join public.provider_units unit
    on unit.id = link.provider_unit_id
  where link.tenant_id is distinct from unit.tenant_id;

  if v_account_mismatches > 0
     or v_vehicle_mismatches > 0
     or v_unit_mismatches > 0 then
    raise exception
      'tracker_tenant_reconciliation_required: units/accounts=%, links/vehicles=%, links/units=%',
      v_account_mismatches,
      v_vehicle_mismatches,
      v_unit_mismatches
      using errcode = '23514';
  end if;
end
$validation$;

alter table public.provider_units
  validate constraint provider_units_tenant_account_fkey;

alter table public.vehicle_tracker_links
  validate constraint vehicle_tracker_links_tenant_vehicle_fkey;

alter table public.vehicle_tracker_links
  validate constraint vehicle_tracker_links_tenant_unit_fkey;

do $postcondition$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where (
      (constraint_row.conrelid = 'public.provider_units'::regclass
       and constraint_row.conname = 'provider_units_tenant_account_fkey')
      or
      (constraint_row.conrelid = 'public.vehicle_tracker_links'::regclass
       and constraint_row.conname in (
         'vehicle_tracker_links_tenant_vehicle_fkey',
         'vehicle_tracker_links_tenant_unit_fkey'
       ))
    )
      and not constraint_row.convalidated
  ) then
    raise exception 'tracker_tenant_constraints_not_validated';
  end if;
end
$postcondition$;
