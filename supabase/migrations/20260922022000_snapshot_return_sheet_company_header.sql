alter table public.loads
  add column if not exists checker_name text,
  add column if not exists helper_name text;

create or replace function private.snapshot_occurrence_return_sheet_company_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_tenant_name text;v_profile jsonb;v_load_snapshot jsonb;v_checker text;v_helper text;
begin
  select tenant.name,coalesce(tenant.settings->'company','{}'::jsonb)
    into v_tenant_name,v_profile
  from public.tenants tenant
  where tenant.id=new.tenant_id;
  if not found then raise exception 'return_sheet_tenant_not_found' using errcode='23503';end if;
  v_load_snapshot:=case
    when jsonb_typeof(new.company_snapshot->'load')='object' then new.company_snapshot->'load'
    else '{}'::jsonb
  end;
  select
    coalesce(nullif(occurrence.metadata->>'conferente',''),nullif(occurrence.metadata->>'checker_name',''),load.checker_name),
    coalesce(nullif(occurrence.metadata->>'ajudante',''),nullif(occurrence.metadata->>'helper_name',''),load.helper_name)
    into v_checker,v_helper
  from public.delivery_occurrences occurrence
  left join public.loads load
    on load.id=occurrence.load_id and load.tenant_id=occurrence.tenant_id
  where occurrence.id=new.occurrence_id and occurrence.tenant_id=new.tenant_id;
  v_load_snapshot:=v_load_snapshot||jsonb_strip_nulls(jsonb_build_object(
    'conferente',v_checker,'helper',v_helper
  ));
  new.company_snapshot:=v_profile
    || coalesce(new.company_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'tenant_name',v_tenant_name,
      'name',coalesce(
        nullif(v_profile->>'trade_name',''),
        nullif(v_profile->>'legal_name',''),
        nullif(new.company_snapshot->>'name',''),
        v_tenant_name
      )
    )
    || jsonb_build_object('load',v_load_snapshot);
  return new;
end $$;

revoke all on function private.snapshot_occurrence_return_sheet_company_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists snapshot_occurrence_return_sheet_company on public.occurrence_return_sheets;
create trigger snapshot_occurrence_return_sheet_company
before insert on public.occurrence_return_sheets
for each row execute function private.snapshot_occurrence_return_sheet_company_v1();
