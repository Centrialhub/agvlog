-- The published fiscal RPCs can bind a document to a load. Enforce that the
-- load belongs to the same tenant, including installations that missed the
-- original 20260921125500 migration. Existing valid links are untouched.
set lock_timeout = '3s';
set statement_timeout = '30s';

do $restore$
begin
  if to_regclass('public.fiscal_documents') is null
    or to_regclass('public.loads') is null then
    raise exception 'fiscal_load_tenant_dependency_missing';
  end if;
  if exists (
    select 1
    from public.fiscal_documents fd
    left join public.loads l on l.id = fd.load_id
    where fd.load_id is not null
      and (l.id is null or l.tenant_id is distinct from fd.tenant_id)
  ) then
    raise exception 'fiscal_load_tenant_existing_link_invalid';
  end if;
end;
$restore$;

create unique index if not exists loads_id_tenant_uidx
  on public.loads (id, tenant_id);

do $restore$
declare
  v_constraint pg_constraint%rowtype;
begin
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = 'public.loads_id_tenant_uidx'::regclass
      and i.indisunique
      and position('(id, tenant_id)' in pg_get_indexdef(i.indexrelid)) > 0
  ) then
    raise exception 'fiscal_load_tenant_index_contract_changed';
  end if;

  select * into v_constraint
  from pg_constraint
  where conrelid = 'public.fiscal_documents'::regclass
    and conname = 'fiscal_documents_load_tenant_fkey';
  if found then
    if v_constraint.contype <> 'f'
      or v_constraint.confrelid <> 'public.loads'::regclass
      or v_constraint.conkey <> array[
        (select attnum from pg_attribute where attrelid='public.fiscal_documents'::regclass and attname='load_id'),
        (select attnum from pg_attribute where attrelid='public.fiscal_documents'::regclass and attname='tenant_id')
      ]::smallint[]
      or v_constraint.confkey <> array[
        (select attnum from pg_attribute where attrelid='public.loads'::regclass and attname='id'),
        (select attnum from pg_attribute where attrelid='public.loads'::regclass and attname='tenant_id')
      ]::smallint[] then
      raise exception 'fiscal_load_tenant_constraint_contract_changed';
    end if;
  else
    alter table public.fiscal_documents
      add constraint fiscal_documents_load_tenant_fkey
      foreign key (load_id, tenant_id)
      references public.loads (id, tenant_id)
      not valid;
  end if;
end;
$restore$;

do $restore$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.fiscal_documents'::regclass
      and conname='fiscal_documents_load_tenant_fkey'
      and not convalidated
  ) then
    alter table public.fiscal_documents
      validate constraint fiscal_documents_load_tenant_fkey;
  end if;
end;
$restore$;
