create or replace function private.apply_shared_projection_columns(
  _table_name text,
  _source jsonb,
  _target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_columns text;
  v_excluded text[] := array['id','tenant_id','workspace_id','created_at','created_by','updated_at','updated_by'];
begin
  if _table_name = 'clients' then
    v_excluded := v_excluded || array[
      'state_registration','municipal_registration','ie_indicator','cfop_client_type','tax_regime',
      'accounting_code_client','accounting_code_supplier','budget_group_client','budget_group_supplier',
      'payment_notes','taxes_enabled','tax_code','tax_description'
    ];
  elsif _table_name = 'drivers' then
    v_excluded := v_excluded || array['current_vehicle_id'];
  elsif _table_name = 'employees' then
    v_excluded := v_excluded || array[
      'manager_id','driver_id','user_id','branch','cost_center','hire_date','termination_date','version'
    ];
  elsif _table_name = 'vehicles' then
    v_excluded := v_excluded || array['current_driver_id'];
  else
    raise exception 'unsupported_shared_projection_table' using errcode = '22023';
  end if;

  select string_agg(quote_ident(a.attname), ',' order by a.attnum)
  into v_columns
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = _table_name
    and a.attnum > 0 and not a.attisdropped
    and not (a.attname = any(v_excluded));

  execute format(
    'update public.%1$I set (%2$s)=(select %2$s from jsonb_populate_record(null::public.%1$I,$1)) where id=$2',
    _table_name, v_columns
  ) using _source, _target_id;
end;
$function$;

revoke all on function private.apply_shared_projection_columns(text,jsonb,uuid)
from public, anon, authenticated, service_role;

create or replace function private.insert_shared_projection(
  _table_name text,
  _source jsonb,
  _tenant_id uuid,
  _workspace_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_payload jsonb;
begin
  if _table_name not in ('clients','drivers','employees','vehicles') then
    raise exception 'unsupported_shared_projection_table' using errcode = '22023';
  end if;

  v_payload := _source || jsonb_build_object(
    'id',v_id,'tenant_id',_tenant_id,'workspace_id',_workspace_id,
    'created_at',now(),'updated_at',now(),'created_by',null,'updated_by',null
  );
  if _table_name = 'drivers' then
    v_payload := v_payload || jsonb_build_object('current_vehicle_id',null);
  elsif _table_name = 'employees' then
    v_payload := v_payload || jsonb_build_object('manager_id',null,'driver_id',null,'user_id',null);
  elsif _table_name = 'vehicles' then
    v_payload := v_payload || jsonb_build_object('current_driver_id',null);
  end if;

  execute format(
    'insert into public.%1$I select (jsonb_populate_record(null::public.%1$I,$1)).*',
    _table_name
  ) using v_payload;
  return v_id;
end;
$function$;

revoke all on function private.insert_shared_projection(text,jsonb,uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function private.sync_workspace_party_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_party_id uuid;
  v_identity text;
  v_target record;
  v_target_id uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;

  select link.workspace_party_id into v_party_id
  from public.workspace_party_tenant_links link
  where link.tenant_id = new.tenant_id and link.client_id = new.id;

  v_identity := case
    when length(regexp_replace(coalesce(new.tax_id,''),'[^0-9]','','g')) between 11 and 14
      then 'tax:'||regexp_replace(new.tax_id,'[^0-9]','','g')
    else 'legacy:'||new.id::text end;

  if v_party_id is null then
    insert into public.workspace_parties(
      id,workspace_id,identity_key,display_name,legal_name,tax_id,is_client,is_supplier,source_data,active,created_at,updated_at
    ) values (
      new.id,new.workspace_id,v_identity,new.company_name,new.legal_name,new.tax_id,new.is_client,new.is_supplier,to_jsonb(new),new.active,new.created_at,new.updated_at
    ) on conflict(workspace_id,identity_key) do update set
      display_name=excluded.display_name,legal_name=excluded.legal_name,tax_id=excluded.tax_id,
      is_client=excluded.is_client,is_supplier=excluded.is_supplier,source_data=excluded.source_data,
      active=excluded.active,updated_at=excluded.updated_at
    returning id into v_party_id;

    insert into public.workspace_party_tenant_links(workspace_id,workspace_party_id,tenant_id,client_id)
    values(new.workspace_id,v_party_id,new.tenant_id,new.id)
    on conflict(tenant_id,client_id) do update set workspace_party_id=excluded.workspace_party_id,workspace_id=excluded.workspace_id;
  else
    update public.workspace_parties set
      display_name=new.company_name,legal_name=new.legal_name,tax_id=new.tax_id,
      is_client=new.is_client,is_supplier=new.is_supplier,source_data=to_jsonb(new),active=new.active,updated_at=new.updated_at
    where id=v_party_id;
  end if;

  for v_target in
    select t.id tenant_id,link.client_id
    from public.tenants t
    left join public.workspace_party_tenant_links link
      on link.workspace_party_id=v_party_id and link.tenant_id=t.id
    where t.workspace_id=new.workspace_id and t.id<>new.tenant_id
  loop
    if v_target.client_id is null then
      v_target_id := private.insert_shared_projection('clients',to_jsonb(new),v_target.tenant_id,new.workspace_id);
      insert into public.workspace_party_tenant_links(workspace_id,workspace_party_id,tenant_id,client_id)
      values(new.workspace_id,v_party_id,v_target.tenant_id,v_target_id);
    else
      perform private.apply_shared_projection_columns('clients',to_jsonb(new),v_target.client_id);
    end if;
  end loop;
  return new;
end;
$function$;

create or replace function private.sync_workspace_person_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind text := case when tg_table_name='drivers' then 'driver' else 'employee' end;
  v_person_id uuid;
  v_identity text;
  v_name text := new.name;
  v_cpf text;
  v_email text := new.email;
  v_phone text := new.phone;
  v_active boolean;
  v_target record;
  v_target_id uuid;
  v_user_id uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  v_cpf := case when tg_table_name='drivers'
    then coalesce(to_jsonb(new)->>'cpf',to_jsonb(new)->>'doc')
    else to_jsonb(new)->>'doc_cpf' end;
  v_active := case when tg_table_name='drivers'
    then coalesce((to_jsonb(new)->>'active')::boolean,false)
    else coalesce(to_jsonb(new)->>'status','inactive')<>'inactive' end;
  v_user_id := nullif(to_jsonb(new)->>'user_id','')::uuid;
  v_identity := case when length(regexp_replace(coalesce(v_cpf,''),'[^0-9]','','g'))=11
    then 'cpf:'||regexp_replace(v_cpf,'[^0-9]','','g') else v_kind||':'||new.id::text end;

  if tg_table_name='drivers' then
    select link.workspace_person_id into v_person_id from public.workspace_person_tenant_links link
    where link.tenant_id=new.tenant_id and link.driver_id=new.id;
  else
    select link.workspace_person_id into v_person_id from public.workspace_person_tenant_links link
    where link.tenant_id=new.tenant_id and link.employee_id=new.id;
  end if;

  if v_person_id is null then
    insert into public.workspace_people(id,workspace_id,identity_key,name,cpf,email,phone,source_data,active,created_at,updated_at)
    values(new.id,new.workspace_id,v_identity,v_name,v_cpf,v_email,v_phone,to_jsonb(new),v_active,new.created_at,new.updated_at)
    on conflict(workspace_id,identity_key) do update set
      name=excluded.name,cpf=excluded.cpf,email=excluded.email,phone=excluded.phone,
      source_data=excluded.source_data,active=excluded.active,updated_at=excluded.updated_at
    returning id into v_person_id;
  else
    update public.workspace_people set name=v_name,cpf=v_cpf,email=v_email,phone=v_phone,
      source_data=to_jsonb(new),active=v_active,updated_at=new.updated_at where id=v_person_id;
  end if;

  if tg_table_name='drivers' then
    insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
    values(new.workspace_id,v_person_id,new.tenant_id,new.id) on conflict(tenant_id,driver_id) do nothing;
  else
    insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,employee_id)
    values(new.workspace_id,v_person_id,new.tenant_id,new.id) on conflict(tenant_id,employee_id) do nothing;
  end if;

  for v_target in
    select t.id tenant_id,
      case when v_kind='driver' then link.driver_id else link.employee_id end projection_id
    from public.tenants t
    left join public.workspace_person_tenant_links link on link.workspace_person_id=v_person_id and link.tenant_id=t.id
      and ((v_kind='driver' and link.driver_id is not null) or (v_kind='employee' and link.employee_id is not null))
    where t.workspace_id=new.workspace_id and t.id<>new.tenant_id
  loop
    if v_kind='driver' and v_user_id is not null then
      insert into public.tenant_memberships(tenant_id,user_id,role,active)
      values(v_target.tenant_id,v_user_id,'driver',true)
      on conflict(tenant_id,user_id) do nothing;
    end if;
    if v_target.projection_id is null then
      v_target_id := private.insert_shared_projection(tg_table_name,to_jsonb(new),v_target.tenant_id,new.workspace_id);
      if v_kind='driver' then
        insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
        values(new.workspace_id,v_person_id,v_target.tenant_id,v_target_id);
      else
        insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,employee_id)
        values(new.workspace_id,v_person_id,v_target.tenant_id,v_target_id);
      end if;
    else
      perform private.apply_shared_projection_columns(tg_table_name,to_jsonb(new),v_target.projection_id);
    end if;
  end loop;
  return new;
end;
$function$;

create or replace function private.sync_workspace_vehicle_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_normalized_plate text;
  v_workspace_vehicle_id uuid;
  v_target record;
  v_target_id uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  v_normalized_plate := upper(regexp_replace(new.plate,'[^A-Za-z0-9]','','g'));
  if v_normalized_plate='' then raise exception 'vehicle_plate_required' using errcode='23514'; end if;

  select link.workspace_vehicle_id into v_workspace_vehicle_id
  from public.workspace_vehicle_tenant_links link
  where link.tenant_id=new.tenant_id and link.vehicle_id=new.id;

  if v_workspace_vehicle_id is null then
    insert into public.workspace_vehicles(id,workspace_id,plate_normalized,plate,nickname,active,source_data,created_at,updated_at)
    values(new.id,new.workspace_id,v_normalized_plate,new.plate,new.nickname,new.active,to_jsonb(new),new.created_at,new.updated_at)
    on conflict(workspace_id,plate_normalized) do update set plate=excluded.plate,nickname=excluded.nickname,
      active=excluded.active,source_data=excluded.source_data,updated_at=excluded.updated_at
    returning id into v_workspace_vehicle_id;
    insert into public.workspace_vehicle_tenant_links(workspace_id,workspace_vehicle_id,tenant_id,vehicle_id)
    values(new.workspace_id,v_workspace_vehicle_id,new.tenant_id,new.id)
    on conflict(tenant_id,vehicle_id) do update set workspace_vehicle_id=excluded.workspace_vehicle_id,workspace_id=excluded.workspace_id;
  else
    update public.workspace_vehicles set plate_normalized=v_normalized_plate,plate=new.plate,nickname=new.nickname,
      active=new.active,source_data=to_jsonb(new),updated_at=new.updated_at where id=v_workspace_vehicle_id;
  end if;

  for v_target in
    select t.id tenant_id,link.vehicle_id
    from public.tenants t left join public.workspace_vehicle_tenant_links link
      on link.workspace_vehicle_id=v_workspace_vehicle_id and link.tenant_id=t.id
    where t.workspace_id=new.workspace_id and t.id<>new.tenant_id
  loop
    if v_target.vehicle_id is null then
      v_target_id:=private.insert_shared_projection('vehicles',to_jsonb(new),v_target.tenant_id,new.workspace_id);
      insert into public.workspace_vehicle_tenant_links(workspace_id,workspace_vehicle_id,tenant_id,vehicle_id)
      values(new.workspace_id,v_workspace_vehicle_id,v_target.tenant_id,v_target_id);
    else
      perform private.apply_shared_projection_columns('vehicles',to_jsonb(new),v_target.vehicle_id);
    end if;
  end loop;
  return new;
end;
$function$;

revoke all on function private.sync_workspace_party_projection(),
  private.sync_workspace_person_projection(),private.sync_workspace_vehicle_projection()
from public,anon,authenticated,service_role;

drop trigger if exists vehicles_sync_workspace_projection on public.vehicles;
create trigger clients_sync_workspace_projection after insert or update on public.clients
for each row execute function private.sync_workspace_party_projection();
create trigger drivers_sync_workspace_projection after insert or update on public.drivers
for each row execute function private.sync_workspace_person_projection();
create trigger employees_sync_workspace_projection after insert or update on public.employees
for each row execute function private.sync_workspace_person_projection();
create trigger vehicles_sync_workspace_projection after insert or update on public.vehicles
for each row execute function private.sync_workspace_vehicle_projection();

-- Materialize missing tenant projections for existing canonical records. The
-- no-op updates invoke the same audited synchronization path used by new data.
update public.clients set updated_at=updated_at;
update public.drivers set updated_at=updated_at;
update public.employees set updated_at=updated_at;
update public.vehicles set updated_at=updated_at;

comment on function private.insert_shared_projection(text,jsonb,uuid,uuid) is
  'Creates a compatibility projection in a sibling tenant; only shared master-data triggers may execute it.';
