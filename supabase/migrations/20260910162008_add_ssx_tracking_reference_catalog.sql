-- Account-scoped reference data needed to interpret SSX PositionHistory.
-- Browser roles cannot read or write raw provider catalogs directly.

create table if not exists public.ssx_tracking_reference_catalog (
  integration_account_id uuid not null
    references public.integration_accounts(id) on delete cascade,
  resource_type text not null,
  external_id text not null,
  name text,
  received_at timestamptz not null default now(),
  primary key (integration_account_id, resource_type, external_id),
  constraint ssx_tracking_reference_catalog_resource_type_check check (
    resource_type in ('actuator', 'event', 'sensor', 'telemetry')
  ),
  constraint ssx_tracking_reference_catalog_external_id_check check (
    external_id <> '' and length(external_id) <= 40
  ),
  constraint ssx_tracking_reference_catalog_name_check check (
    name is null or length(name) <= 500
  )
);

alter table public.ssx_tracking_reference_catalog enable row level security;
revoke all on table public.ssx_tracking_reference_catalog
from public, anon, authenticated;

create or replace function public.replace_ssx_tracking_reference_catalog_v1(
  _integration_account_id uuid,
  _resource_type text,
  _items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if _resource_type not in ('actuator', 'event', 'sensor', 'telemetry') then
    raise exception 'ssx_reference_catalog_type_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) > 10000 then
    raise exception 'ssx_reference_catalog_items_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.integration_accounts account
    where account.id = _integration_account_id and lower(account.provider) = 'ssx'
  ) then
    raise exception 'ssx_reference_catalog_account_not_found' using errcode = '23503';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(_items) item
    where jsonb_typeof(item) <> 'object'
      or nullif(btrim(item ->> 'external_id'), '') is null
      or length(btrim(item ->> 'external_id')) > 40
      or (item ? 'name' and item -> 'name' <> 'null'::jsonb
        and jsonb_typeof(item -> 'name') <> 'string')
      or length(coalesce(item ->> 'name', '')) > 500
  ) then
    raise exception 'ssx_reference_catalog_item_invalid' using errcode = '22023';
  end if;

  delete from public.ssx_tracking_reference_catalog catalog
  where catalog.integration_account_id = _integration_account_id
    and catalog.resource_type = _resource_type;

  insert into public.ssx_tracking_reference_catalog(
    integration_account_id, resource_type, external_id, name, received_at
  )
  select
    _integration_account_id,
    _resource_type,
    btrim(item ->> 'external_id'),
    nullif(btrim(item ->> 'name'), ''),
    now()
  from jsonb_array_elements(_items) item
  on conflict (integration_account_id, resource_type, external_id)
  do update set name = excluded.name, received_at = excluded.received_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.replace_ssx_tracking_reference_catalog_v1(uuid,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.replace_ssx_tracking_reference_catalog_v1(uuid,text,jsonb)
to service_role;

comment on table public.ssx_tracking_reference_catalog is
  'Minimal account-scoped SSX reference catalogs used to interpret position payload identifiers.';
