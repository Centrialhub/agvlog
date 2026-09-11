alter table public.trip_cargo_divergences
  add column if not exists document_check_id uuid references public.trip_cargo_document_checks(id) on delete restrict;

create or replace function private.normalize_trip_cargo_load_expectation_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_count numeric;
begin
  select sum(document.volume_count) into v_count
  from public.fiscal_documents as document
  where document.tenant_id=new.tenant_id and document.load_id=new.load_id
    and document.deleted_at is null and document.volume_count is not null;
  new.expected_volume_count:=v_count;
  return new;
end;$function$;
revoke all on function private.normalize_trip_cargo_load_expectation_v1() from public,anon,authenticated,service_role;
create trigger normalize_trip_cargo_load_expectation_v1
before insert or update of load_id,expected_volume_count on public.trip_cargo_load_checks
for each row execute function private.normalize_trip_cargo_load_expectation_v1();

create or replace function private.validate_trip_cargo_divergence_scope_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_document uuid;v_count bigint;
begin
  if new.load_id is not null and not exists(select 1 from public.trip_cargo_load_checks as check_row
    where check_row.control_id=new.control_id and check_row.tenant_id=new.tenant_id and check_row.load_id=new.load_id) then
    raise exception 'trip_cargo_divergence_load_outside_trip' using errcode='23514';
  end if;
  if new.divergence_kind='document' then
    if new.document_check_id is null and nullif(new.observed_value,'') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      new.document_check_id:=new.observed_value::uuid;
    end if;
    if new.document_check_id is null then
      select count(*),(array_agg(document.id order by document.id))[1] into v_count,v_document
      from public.trip_cargo_document_checks as document
      where document.control_id=new.control_id and document.tenant_id=new.tenant_id
        and (new.load_id is null or document.load_id=new.load_id);
      if v_count=1 then new.document_check_id:=v_document; end if;
    end if;
    if new.document_check_id is null or not exists(select 1 from public.trip_cargo_document_checks as document
      where document.id=new.document_check_id and document.control_id=new.control_id and document.tenant_id=new.tenant_id
        and (new.load_id is null or document.load_id=new.load_id)) then
      raise exception 'trip_cargo_divergence_document_required' using errcode='23514';
    end if;
  elsif new.document_check_id is not null then
    raise exception 'trip_cargo_divergence_document_invalid' using errcode='23514';
  end if;
  return new;
end;$function$;
revoke all on function private.validate_trip_cargo_divergence_scope_v1() from public,anon,authenticated,service_role;
create trigger validate_trip_cargo_divergence_scope_v1
before insert or update of tenant_id,control_id,load_id,divergence_kind,document_check_id,observed_value
on public.trip_cargo_divergences for each row execute function private.validate_trip_cargo_divergence_scope_v1();

create or replace function private.validate_trip_cargo_evidence_object_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not exists(select 1 from storage.objects as object
    where object.bucket_id=new.storage_bucket and object.name=new.storage_path) then
    raise exception 'trip_cargo_evidence_object_missing' using errcode='23514';
  end if;
  return new;
end;$function$;
revoke all on function private.validate_trip_cargo_evidence_object_v1() from public,anon,authenticated,service_role;
create trigger validate_trip_cargo_evidence_object_v1
before insert or update of storage_bucket,storage_path on public.trip_cargo_evidence
for each row execute function private.validate_trip_cargo_evidence_object_v1();

create or replace function public.driver_update_trip_cargo_v1(
  _tenant_id uuid,_trip_id uuid,_request_id uuid,_action text,_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_existing public.trip_cargo_commands%rowtype;v_existing_trip uuid;
begin
  select * into v_existing from public.trip_cargo_commands where request_id=_request_id;
  if found then
    select control.dispatch_trip_id into v_existing_trip from public.trip_cargo_controls as control
      where control.id=v_existing.control_id and control.tenant_id=v_existing.tenant_id;
    if v_existing_trip is distinct from _trip_id then
      raise exception 'trip_cargo_request_conflict' using errcode='23505';
    end if;
  end if;
  return private.driver_update_trip_cargo(_tenant_id,_trip_id,_request_id,_action,_payload);
end;$function$;
revoke all on function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) to authenticated;

comment on column public.trip_cargo_load_checks.expected_volume_count is
  'Canonical count of physical volumes summed from active fiscal documents; never cubic volume.';
comment on column public.trip_cargo_divergences.document_check_id is
  'Affected canonical document in this cargo control when divergence_kind=document.';
