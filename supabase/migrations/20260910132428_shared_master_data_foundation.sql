create or replace function private.workspace_from_tenant(_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select t.workspace_id from public.tenants t where t.id = _tenant_id;
$function$;

revoke all on function private.workspace_from_tenant(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.workspace_from_tenant(uuid)
to authenticated, service_role;

alter table public.clients add column workspace_id uuid;
alter table public.drivers add column workspace_id uuid;
alter table public.employees add column workspace_id uuid;
alter table public.vehicles add column workspace_id uuid;
alter table public.integration_accounts add column workspace_id uuid;

update public.clients c set workspace_id = private.workspace_from_tenant(c.tenant_id);
update public.drivers d set workspace_id = private.workspace_from_tenant(d.tenant_id);
update public.employees e set workspace_id = private.workspace_from_tenant(e.tenant_id);
update public.vehicles v set workspace_id = private.workspace_from_tenant(v.tenant_id);
update public.integration_accounts i set workspace_id = private.workspace_from_tenant(i.tenant_id);

alter table public.clients alter column workspace_id set not null;
alter table public.drivers alter column workspace_id set not null;
alter table public.employees alter column workspace_id set not null;
alter table public.vehicles alter column workspace_id set not null;
alter table public.integration_accounts alter column workspace_id set not null;

alter table public.clients add constraint clients_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.drivers add constraint drivers_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.employees add constraint employees_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.vehicles add constraint vehicles_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.integration_accounts add constraint integration_accounts_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete restrict;

create index clients_workspace_id_idx on public.clients(workspace_id);
create index drivers_workspace_id_idx on public.drivers(workspace_id);
create index employees_workspace_id_idx on public.employees(workspace_id);
create index vehicles_workspace_id_idx on public.vehicles(workspace_id);
create index integration_accounts_workspace_provider_idx on public.integration_accounts(workspace_id,provider);

create or replace function private.enforce_workspace_from_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := private.workspace_from_tenant(new.tenant_id);
  if v_workspace_id is null then
    raise exception 'tenant_workspace_not_found' using errcode = '23503';
  end if;
  if new.workspace_id is not null and new.workspace_id <> v_workspace_id then
    raise exception 'workspace_tenant_mismatch' using errcode = '23514';
  end if;
  new.workspace_id := v_workspace_id;
  return new;
end;
$function$;

revoke all on function private.enforce_workspace_from_tenant()
from public, anon, authenticated, service_role;

create trigger clients_enforce_workspace before insert or update of tenant_id,workspace_id on public.clients for each row execute function private.enforce_workspace_from_tenant();
create trigger drivers_enforce_workspace before insert or update of tenant_id,workspace_id on public.drivers for each row execute function private.enforce_workspace_from_tenant();
create trigger employees_enforce_workspace before insert or update of tenant_id,workspace_id on public.employees for each row execute function private.enforce_workspace_from_tenant();
create trigger vehicles_enforce_workspace before insert or update of tenant_id,workspace_id on public.vehicles for each row execute function private.enforce_workspace_from_tenant();
create trigger integration_accounts_enforce_workspace before insert or update of tenant_id,workspace_id on public.integration_accounts for each row execute function private.enforce_workspace_from_tenant();

create table public.workspace_parties (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  identity_key text not null,
  display_name text not null,
  legal_name text,
  tax_id text,
  is_client boolean not null default false,
  is_supplier boolean not null default false,
  source_data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,identity_key),
  unique(workspace_id,id)
);

create table public.workspace_party_tenant_links (
  workspace_id uuid not null,
  workspace_party_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  fiscal_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(tenant_id,client_id),
  unique(workspace_party_id,tenant_id),
  foreign key(workspace_id,workspace_party_id) references public.workspace_parties(workspace_id,id) on delete cascade
);

create table public.workspace_people (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  identity_key text not null,
  name text not null,
  cpf text,
  email text,
  phone text,
  source_data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,identity_key),
  unique(workspace_id,id)
);

create table public.workspace_person_tenant_links (
  workspace_id uuid not null,
  workspace_person_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  employment_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(num_nonnulls(driver_id,employee_id)=1),
  unique(tenant_id,driver_id),
  unique(tenant_id,employee_id),
  foreign key(workspace_id,workspace_person_id) references public.workspace_people(workspace_id,id) on delete cascade
);

create table public.workspace_vehicles (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plate_normalized text not null,
  plate text not null,
  nickname text,
  source_data jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,plate_normalized),
  unique(workspace_id,id)
);

create table public.workspace_vehicle_tenant_links (
  workspace_id uuid not null,
  workspace_vehicle_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  accounting_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(tenant_id,vehicle_id),
  unique(workspace_vehicle_id,tenant_id),
  foreign key(workspace_id,workspace_vehicle_id) references public.workspace_vehicles(workspace_id,id) on delete cascade
);

create table public.workspace_ssx_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  integration_account_id uuid not null unique references public.integration_accounts(id) on delete restrict,
  migration_state text not null check(migration_state in('ready','needs_resolution')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

with source as (
  select c.*,
    case when length(regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g')) between 11 and 14
      then 'tax:'||regexp_replace(c.tax_id,'[^0-9]','','g') else 'legacy:'||c.id::text end identity_key
  from public.clients c
), grouped as (
  select workspace_id,identity_key,(array_agg(id order by created_at,id))[1] id,
    (array_agg(company_name order by created_at,id))[1] display_name,
    (array_agg(legal_name order by created_at,id))[1] legal_name,
    (array_agg(tax_id order by created_at,id))[1] tax_id,
    bool_or(is_client) is_client,bool_or(is_supplier) is_supplier,
    (array_agg(to_jsonb(source) order by created_at,id))[1] source_data,
    bool_or(active) active,min(created_at) created_at,max(updated_at) updated_at
  from source group by workspace_id,identity_key
)
insert into public.workspace_parties(id,workspace_id,identity_key,display_name,legal_name,tax_id,is_client,is_supplier,source_data,active,created_at,updated_at)
select id,workspace_id,identity_key,display_name,legal_name,tax_id,is_client,is_supplier,source_data,active,created_at,updated_at from grouped;

with source as (
  select c.id,c.tenant_id,c.workspace_id,
    case when length(regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g')) between 11 and 14
      then 'tax:'||regexp_replace(c.tax_id,'[^0-9]','','g') else 'legacy:'||c.id::text end identity_key
  from public.clients c
)
insert into public.workspace_party_tenant_links(workspace_id,workspace_party_id,tenant_id,client_id)
select s.workspace_id,p.id,s.tenant_id,s.id from source s join public.workspace_parties p using(workspace_id,identity_key);

with source as (
  select d.id,d.tenant_id,d.workspace_id,'driver' kind,d.name,coalesce(d.cpf,d.doc) cpf,d.email,d.phone,d.active,d.created_at,d.updated_at,to_jsonb(d) source_data
  from public.drivers d
  union all
  select e.id,e.tenant_id,e.workspace_id,'employee',e.name,e.doc_cpf,e.email,e.phone,e.status<>'inactive',e.created_at,e.updated_at,to_jsonb(e)
  from public.employees e
), keyed as (
  select *,case when length(regexp_replace(coalesce(cpf,''),'[^0-9]','','g'))=11
    then 'cpf:'||regexp_replace(cpf,'[^0-9]','','g') else kind||':'||id::text end identity_key from source
), grouped as (
  select workspace_id,identity_key,(array_agg(id order by created_at,id))[1] id,
    (array_agg(name order by created_at,id))[1] name,(array_agg(cpf order by created_at,id))[1] cpf,
    (array_agg(email order by created_at,id))[1] email,(array_agg(phone order by created_at,id))[1] phone,
    (array_agg(source_data order by created_at,id))[1] source_data,bool_or(active) active,
    min(created_at) created_at,max(updated_at) updated_at
  from keyed group by workspace_id,identity_key
)
insert into public.workspace_people(id,workspace_id,identity_key,name,cpf,email,phone,source_data,active,created_at,updated_at)
select id,workspace_id,identity_key,name,cpf,email,phone,source_data,active,created_at,updated_at from grouped;

with source as (
  select d.id,d.tenant_id,d.workspace_id,'driver' kind,
    case when length(regexp_replace(coalesce(d.cpf,d.doc,''),'[^0-9]','','g'))=11 then 'cpf:'||regexp_replace(coalesce(d.cpf,d.doc),'[^0-9]','','g') else 'driver:'||d.id::text end identity_key
  from public.drivers d
  union all
  select e.id,e.tenant_id,e.workspace_id,'employee',
    case when length(regexp_replace(coalesce(e.doc_cpf,''),'[^0-9]','','g'))=11 then 'cpf:'||regexp_replace(e.doc_cpf,'[^0-9]','','g') else 'employee:'||e.id::text end identity_key
  from public.employees e
)
insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id,employee_id)
select s.workspace_id,p.id,s.tenant_id,case when s.kind='driver' then s.id end,case when s.kind='employee' then s.id end
from source s join public.workspace_people p using(workspace_id,identity_key);

with source as (
  select v.*,upper(regexp_replace(v.plate,'[^A-Za-z0-9]','','g')) plate_normalized from public.vehicles v
), grouped as (
  select workspace_id,plate_normalized,(array_agg(id order by created_at,id))[1] id,
    (array_agg(plate order by created_at,id))[1] plate,(array_agg(nickname order by created_at,id))[1] nickname,
    (array_agg(to_jsonb(source) order by created_at,id))[1] source_data,bool_or(active) active,
    min(created_at) created_at,max(updated_at) updated_at
  from source group by workspace_id,plate_normalized
)
insert into public.workspace_vehicles(id,workspace_id,plate_normalized,plate,nickname,source_data,active,created_at,updated_at)
select id,workspace_id,plate_normalized,plate,nickname,source_data,active,created_at,updated_at from grouped;

insert into public.workspace_vehicle_tenant_links(workspace_id,workspace_vehicle_id,tenant_id,vehicle_id)
select v.workspace_id,wv.id,v.tenant_id,v.id
from public.vehicles v join public.workspace_vehicles wv
  on wv.workspace_id=v.workspace_id and wv.plate_normalized=upper(regexp_replace(v.plate,'[^A-Za-z0-9]','','g'));

with ranked as (
  select i.workspace_id,i.id,count(*) over(partition by i.workspace_id) account_count,
    row_number() over(partition by i.workspace_id order by case when i.status='ok' then 0 else 1 end,i.created_at,i.id) position
  from public.integration_accounts i where lower(i.provider)='ssx'
)
insert into public.workspace_ssx_accounts(workspace_id,integration_account_id,migration_state)
select workspace_id,id,case when account_count=1 then 'ready' else 'needs_resolution' end
from ranked where position=1;

create trigger workspace_parties_set_updated_at before update on public.workspace_parties for each row execute function public.update_updated_at_column();
create trigger workspace_people_set_updated_at before update on public.workspace_people for each row execute function public.update_updated_at_column();
create trigger workspace_vehicles_set_updated_at before update on public.workspace_vehicles for each row execute function public.update_updated_at_column();
create trigger workspace_ssx_accounts_set_updated_at before update on public.workspace_ssx_accounts for each row execute function public.update_updated_at_column();

-- Keep the RLS boundary explicit for static deployment-contract tooling. The
-- loop below remains responsible for applying the identical policies and ACLs.
alter table public.workspace_parties enable row level security;
alter table public.workspace_party_tenant_links enable row level security;
alter table public.workspace_people enable row level security;
alter table public.workspace_person_tenant_links enable row level security;
alter table public.workspace_vehicles enable row level security;
alter table public.workspace_vehicle_tenant_links enable row level security;
alter table public.workspace_ssx_accounts enable row level security;

do $shared_rls$
declare table_name text;
begin
  foreach table_name in array array['workspace_parties','workspace_party_tenant_links','workspace_people','workspace_person_tenant_links','workspace_vehicles','workspace_vehicle_tenant_links','workspace_ssx_accounts']
  loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy workspace_member_read on public.%I for select to authenticated using(private.is_workspace_member(workspace_id))',table_name);
    execute format('create policy workspace_admin_write on public.%I for all to authenticated using(private.is_workspace_admin(workspace_id)) with check(private.is_workspace_admin(workspace_id))',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
    execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end;
$shared_rls$;

comment on table public.workspace_parties is 'Canonical shared clients and suppliers; tenant links preserve fiscal/accounting projections.';
comment on table public.workspace_people is 'Canonical shared employees and drivers; tenant links preserve employment and operational projections.';
comment on table public.workspace_vehicles is 'Canonical physical fleet shared across companies in a workspace.';
comment on table public.workspace_ssx_accounts is 'Single SSX registration selected for the workspace; needs_resolution blocks ambiguous legacy duplicates.';
