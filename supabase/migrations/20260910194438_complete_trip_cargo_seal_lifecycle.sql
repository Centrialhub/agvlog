-- Complete the physical seal lifecycle. New seals require photographic evidence
-- at installation and at their terminal transition. Existing records receive an
-- explicit legacy waiver rather than an unverifiable synthetic proof.

alter table public.trip_cargo_seals
  add column if not exists installed_evidence_id uuid references public.trip_cargo_evidence(id) on delete restrict,
  add column if not exists installation_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolution_reason text,
  add column if not exists resolution_evidence_id uuid references public.trip_cargo_evidence(id) on delete restrict,
  add column if not exists evidence_waived_legacy boolean not null default false;

update public.trip_cargo_seals
set installation_reason=coalesce(nullif(btrim(installation_reason),''),'Instalado durante a conferência da carga'),
  resolved_at=case when status='installed' then null else coalesce(resolved_at,removed_at,installed_at) end,
  resolved_by=case when status='installed' then null else coalesce(resolved_by,removed_by,installed_by) end,
  resolution_reason=case when status='installed' then null else coalesce(nullif(btrim(resolution_reason),''),nullif(btrim(notes),''),'Situação registrada antes da evidência obrigatória') end,
  evidence_waived_legacy=true;

alter table public.trip_cargo_seals
  alter column installation_reason set default 'Instalado durante a conferência da carga',
  alter column installation_reason set not null,
  add constraint trip_cargo_seal_installation_reason_length check(length(btrim(installation_reason)) between 5 and 500),
  add constraint trip_cargo_seal_resolution_reason_length check(resolution_reason is null or length(btrim(resolution_reason)) between 5 and 1000),
  add constraint trip_cargo_seal_terminal_state_complete check(
    (status='installed' and resolved_at is null and resolved_by is null and resolution_reason is null and resolution_evidence_id is null)
    or
    (status in('removed','broken','missing') and resolved_at is not null and resolved_by is not null
      and resolution_reason is not null and (resolution_evidence_id is not null or evidence_waived_legacy))
  );

create unique index if not exists trip_cargo_seal_resolution_evidence_idx
  on public.trip_cargo_seals(resolution_evidence_id) where resolution_evidence_id is not null;
create unique index if not exists trip_cargo_seal_installation_evidence_idx
  on public.trip_cargo_seals(installed_evidence_id) where installed_evidence_id is not null;

create or replace function private.validate_trip_cargo_seal_lifecycle_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if tg_op='INSERT' and new.status<>'installed' then
    raise exception 'trip_cargo_seal_must_start_installed' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.status<>'installed' and (
    new.status is distinct from old.status or new.resolved_at is distinct from old.resolved_at
    or new.resolved_by is distinct from old.resolved_by or new.resolution_reason is distinct from old.resolution_reason
    or new.resolution_evidence_id is distinct from old.resolution_evidence_id
  ) then
    raise exception 'trip_cargo_seal_terminal_state_immutable' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.status='installed' and new.status<>'installed'
    and (new.status not in('removed','broken','missing') or new.resolved_at is null or new.resolved_by is null
      or length(btrim(coalesce(new.resolution_reason,'')))<5 or new.resolution_evidence_id is null) then
    raise exception 'trip_cargo_seal_resolution_incomplete' using errcode='23514';
  end if;
  if new.installed_evidence_id is not null and not exists(
    select 1 from public.trip_cargo_evidence evidence where evidence.id=new.installed_evidence_id
      and evidence.tenant_id=new.tenant_id and evidence.control_id=new.control_id and evidence.evidence_kind='seal'
  ) then raise exception 'trip_cargo_seal_installation_evidence_invalid' using errcode='23514';end if;
  if new.resolution_evidence_id is not null and not exists(
    select 1 from public.trip_cargo_evidence evidence where evidence.id=new.resolution_evidence_id
      and evidence.tenant_id=new.tenant_id and evidence.control_id=new.control_id and evidence.evidence_kind='seal'
  ) then raise exception 'trip_cargo_seal_resolution_evidence_invalid' using errcode='23514';end if;
  return new;
end;$function$;
revoke all on function private.validate_trip_cargo_seal_lifecycle_v1() from public,anon,authenticated,service_role;
create trigger validate_trip_cargo_seal_lifecycle_v1
before insert or update on public.trip_cargo_seals
for each row execute function private.validate_trip_cargo_seal_lifecycle_v1();

create or replace function private.require_trip_cargo_seals_before_boundary_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.status in('departed','returned','closed') and exists(
    select 1 from public.trip_cargo_seals seal_row where seal_row.control_id=new.id
      and seal_row.installed_evidence_id is null and not seal_row.evidence_waived_legacy
  ) then raise exception 'trip_cargo_seal_installation_evidence_required' using errcode='23514';end if;
  if new.status in('returned','closed') and exists(
    select 1 from public.trip_cargo_seals seal_row where seal_row.control_id=new.id and seal_row.status='installed'
  ) then raise exception 'trip_cargo_seal_resolution_required' using errcode='23514';end if;
  return new;
end;$function$;
revoke all on function private.require_trip_cargo_seals_before_boundary_v1() from public,anon,authenticated,service_role;
create trigger require_trip_cargo_seals_before_boundary_v1
before insert or update of status on public.trip_cargo_controls
for each row execute function private.require_trip_cargo_seals_before_boundary_v1();

create or replace function private.resolve_trip_cargo_seals_v1(
  _tenant_id uuid,_trip_id uuid,_request_id uuid,_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;
  v_existing public.trip_cargo_commands%rowtype;v_seal public.trip_cargo_seals%rowtype;
  v_item jsonb;v_evidence_id uuid;v_status text;v_reason text;v_path text;v_hash text;v_result jsonb;v_count integer:=0;
begin
  if _request_id is null or jsonb_typeof(coalesce(_payload,'{}'::jsonb))<>'object'
    or jsonb_typeof(_payload->'seals')<>'array' or jsonb_array_length(_payload->'seals')<1
    or jsonb_array_length(_payload->'seals')>100 or pg_catalog.octet_length(_payload::text)>262144 then
    raise exception 'trip_cargo_seal_resolution_invalid' using errcode='22023';end if;
  v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trip_cargo:'||_tenant_id::text||':'||_trip_id::text,0));
  v_hash:=md5('resolve_seals:'||_payload::text);
  select * into v_existing from public.trip_cargo_commands where request_id=_request_id;
  if found then
    if v_existing.tenant_id<>_tenant_id or v_existing.actor_id<>auth.uid() or v_existing.action<>'resolve_seals' or v_existing.payload_hash<>v_hash then
      raise exception 'trip_cargo_request_conflict' using errcode='23505';end if;
    return v_existing.result;
  end if;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id for update;
  if not found or v_control.driver_id<>v_trip.driver_id or v_control.vehicle_id<>v_trip.vehicle_id then
    raise exception 'trip_cargo_control_not_found' using errcode='P0002';end if;
  if v_control.status<>'departed' then raise exception 'trip_cargo_seal_resolution_wrong_state' using errcode='23514';end if;
  for v_item in select value from jsonb_array_elements(_payload->'seals') loop
    v_status:=v_item->>'status';v_reason:=btrim(coalesce(v_item->>'reason',''));v_path:=v_item->>'evidence_path';
    if v_status not in('removed','broken','missing') or length(v_reason)<5 or length(v_reason)>1000
      or v_path not like _tenant_id::text||'/trip-cargo/'||_trip_id::text||'/%' then
      raise exception 'trip_cargo_seal_resolution_invalid' using errcode='22023';end if;
    select * into v_seal from public.trip_cargo_seals where id=(v_item->>'seal_id')::uuid
      and tenant_id=_tenant_id and control_id=v_control.id for update;
    if not found then raise exception 'trip_cargo_seal_not_found' using errcode='P0002';end if;
    if v_seal.status<>'installed' then raise exception 'trip_cargo_seal_already_resolved' using errcode='23514';end if;
    insert into public.trip_cargo_evidence(tenant_id,control_id,evidence_kind,storage_path,created_by)
      values(_tenant_id,v_control.id,'seal',v_path,auth.uid()) returning id into v_evidence_id;
    update public.trip_cargo_seals set status=v_status,resolved_at=clock_timestamp(),resolved_by=auth.uid(),
      removed_at=case when v_status='removed' then clock_timestamp() else null end,
      removed_by=case when v_status='removed' then auth.uid() else null end,
      resolution_reason=v_reason,resolution_evidence_id=v_evidence_id,notes=v_reason
    where id=v_seal.id returning * into v_seal;
    if v_status in('broken','missing') then
      insert into public.trip_cargo_divergences(tenant_id,control_id,divergence_kind,description,expected_value,observed_value,reported_by)
      values(_tenant_id,v_control.id,'seal','Lacre '||v_seal.seal_number||case when v_status='broken' then ' retornou rompido' else ' não retornou' end,
        'removed',v_status,auth.uid());
    end if;
    perform public._log_entity_audit(_tenant_id,'trip_cargo_seal',v_seal.id,'seal_status_changed',null,
      jsonb_build_object('status',v_status,'reason',v_reason,'evidence_id',v_evidence_id,'resolved_at',v_seal.resolved_at,'resolved_by',v_seal.resolved_by),'driver_app');
    v_count:=v_count+1;
  end loop;
  v_result:=jsonb_build_object('version',1,'confirmed',true,'request_id',_request_id,'trip_id',_trip_id,
    'control_id',v_control.id,'status',v_control.status,'resolved_count',v_count,
    'remaining_installed',(select count(*) from public.trip_cargo_seals where control_id=v_control.id and status='installed'),
    'updated_at',clock_timestamp());
  insert into public.trip_cargo_commands(request_id,tenant_id,control_id,actor_id,action,payload_hash,result)
    values(_request_id,_tenant_id,v_control.id,auth.uid(),'resolve_seals',v_hash,v_result);
  return v_result;
end;$function$;
revoke all on function private.resolve_trip_cargo_seals_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.driver_update_trip_cargo_v1(
  _tenant_id uuid,_trip_id uuid,_request_id uuid,_action text,_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_existing public.trip_cargo_commands%rowtype;v_existing_trip uuid;v_result jsonb;v_item jsonb;
  v_control_id uuid;v_evidence_id uuid;v_seal_count integer;
  v_hash text:=md5(_action||':'||coalesce(_payload,'{}'::jsonb)::text);
begin
  perform private.require_trip_cargo_actor(_tenant_id,_trip_id,false);
  select * into v_existing from public.trip_cargo_commands where request_id=_request_id;
  if found then
    select control.dispatch_trip_id into v_existing_trip from public.trip_cargo_controls control
      where control.id=v_existing.control_id and control.tenant_id=v_existing.tenant_id;
    if v_existing_trip is distinct from _trip_id or v_existing.tenant_id<>_tenant_id
      or v_existing.actor_id<>auth.uid() or v_existing.action<>_action or v_existing.payload_hash<>v_hash then
      raise exception 'trip_cargo_request_conflict' using errcode='23505';end if;
    return v_existing.result;
  end if;
  if _action='resolve_seals' then return private.resolve_trip_cargo_seals_v1(_tenant_id,_trip_id,_request_id,_payload);end if;
  if _action='mark_returned' and exists(
    select 1 from public.trip_cargo_seals seal_row join public.trip_cargo_controls control on control.id=seal_row.control_id
    where control.tenant_id=_tenant_id and control.dispatch_trip_id=_trip_id and seal_row.status='installed'
  ) then raise exception 'trip_cargo_seal_resolution_required' using errcode='23514';end if;
  v_result:=private.driver_update_trip_cargo(_tenant_id,_trip_id,_request_id,_action,_payload);
  if _action<>'confirm_cargo' then return v_result;end if;
  v_control_id:=(v_result->>'control_id')::uuid;
  select count(*) into v_seal_count from public.trip_cargo_seals
    where control_id=v_control_id and status='installed' and not evidence_waived_legacy;
  if v_seal_count=0 then return v_result;end if;
  if jsonb_typeof(_payload->'seal_evidence')<>'array' or jsonb_array_length(_payload->'seal_evidence')<>v_seal_count then
    raise exception 'trip_cargo_seal_installation_evidence_required' using errcode='23514';end if;
  for v_item in select value from jsonb_array_elements(_payload->'seal_evidence') loop
    if length(btrim(coalesce(v_item->>'seal_number','')))<2
      or (v_item->>'path') not like _tenant_id::text||'/trip-cargo/'||_trip_id::text||'/%' then
      raise exception 'trip_cargo_seal_installation_evidence_invalid' using errcode='22023';end if;
    select evidence.id into v_evidence_id from public.trip_cargo_evidence evidence
    where evidence.tenant_id=_tenant_id and evidence.control_id=v_control_id and evidence.evidence_kind='seal'
      and evidence.storage_path=v_item->>'path';
    if not found then raise exception 'trip_cargo_seal_installation_evidence_invalid' using errcode='23514';end if;
    update public.trip_cargo_seals set installed_evidence_id=v_evidence_id
    where tenant_id=_tenant_id and control_id=v_control_id and status='installed' and not evidence_waived_legacy
      and installed_evidence_id is null and seal_number=btrim(v_item->>'seal_number');
    if not found then raise exception 'trip_cargo_seal_installation_evidence_ambiguous' using errcode='23514';end if;
  end loop;
  if exists(select 1 from public.trip_cargo_seals where control_id=v_control_id and status='installed'
    and installed_evidence_id is null and not evidence_waived_legacy) then
    raise exception 'trip_cargo_seal_installation_evidence_required' using errcode='23514';end if;
  return v_result;
end;$function$;
revoke all on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) to authenticated;

comment on column public.trip_cargo_seals.installed_evidence_id is 'Required photograph of the physical seal as installed; legacy rows carry an explicit waiver.';
comment on column public.trip_cargo_seals.resolution_evidence_id is 'Required photograph proving removal, breakage, or absence at physical return.';
comment on column public.trip_cargo_seals.evidence_waived_legacy is 'Migration-only marker for records created before mandatory seal evidence; new writes default to false.';
