-- Durable, reviewable SSX unit/vehicle mapping conflicts.
-- New public relations are fail-closed: the browser can only use the narrowly
-- scoped RPCs below and the sync worker writes through a service-role RPC.

create table public.ssx_mapping_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  provider_unit_id uuid not null references public.provider_units(id) on delete cascade,
  external_code text not null,
  observed_plate text,
  normalized_plate text,
  conflict_type text not null check (conflict_type in ('ambiguous_plate_match','mapping_conflict')),
  candidate_vehicle_ids uuid[] not null default '{}'::uuid[],
  linked_vehicle_id uuid references public.vehicles(id) on delete restrict,
  owner_role text not null default 'operations' check (owner_role = 'operations'),
  status text not null default 'open' check (status in ('open','resolved')),
  first_observed_at timestamptz not null default clock_timestamp(),
  last_observed_at timestamptz not null default clock_timestamp(),
  due_at timestamptz not null default (clock_timestamp() + interval '4 hours'),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolution_reason text,
  resolved_vehicle_id uuid references public.vehicles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'open' and resolved_at is null and resolved_by is null and resolution_reason is null and resolved_vehicle_id is null)
    or
    (status = 'resolved' and resolved_at is not null and resolved_by is not null
      and length(btrim(resolution_reason)) >= 3 and resolved_vehicle_id is not null)
  )
);

create unique index uq_ssx_mapping_conflicts_open
  on public.ssx_mapping_conflicts (tenant_id, integration_account_id, provider_unit_id, conflict_type)
  where status = 'open';
create index idx_ssx_mapping_conflicts_review
  on public.ssx_mapping_conflicts (tenant_id, status, due_at, first_observed_at);

alter table public.ssx_mapping_conflicts enable row level security;
revoke all on table public.ssx_mapping_conflicts from public, anon, authenticated;
grant select, insert, update on table public.ssx_mapping_conflicts to service_role;

create or replace function public.report_ssx_mapping_conflict_v1(_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_tenant_id uuid := (_payload->>'tenant_id')::uuid;
  v_account_id uuid := (_payload->>'integration_account_id')::uuid;
  v_unit_id uuid := (_payload->>'provider_unit_id')::uuid;
  v_type text := nullif(btrim(_payload->>'conflict_type'),'');
  v_external_code text := nullif(btrim(_payload->>'external_code'),'');
  v_observed_plate text := nullif(btrim(_payload->>'observed_plate'),'');
  v_normalized_plate text := nullif(btrim(_payload->>'normalized_plate'),'');
  v_linked_vehicle_id uuid := nullif(_payload->>'linked_vehicle_id','')::uuid;
  v_candidates uuid[] := coalesce(array(
    select distinct value::uuid
    from jsonb_array_elements_text(coalesce(_payload->'candidate_vehicle_ids','[]'::jsonb)) as candidate(value)
    order by value::uuid
  ), '{}'::uuid[]);
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if v_type not in ('ambiguous_plate_match','mapping_conflict') or v_external_code is null then
    raise exception 'invalid_ssx_mapping_conflict' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.provider_units unit
    where unit.id = v_unit_id and unit.tenant_id = v_tenant_id
      and unit.integration_account_id = v_account_id
  ) then
    raise exception 'provider_unit_scope_mismatch' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(v_candidates) candidate_id
    where not exists (
      select 1 from public.vehicles vehicle
      where vehicle.id = candidate_id and vehicle.tenant_id = v_tenant_id and vehicle.active
    )
  ) then
    raise exception 'candidate_vehicle_scope_mismatch' using errcode = '23514';
  end if;
  if v_linked_vehicle_id is not null and not exists (
    select 1 from public.vehicles vehicle
    where vehicle.id = v_linked_vehicle_id and vehicle.tenant_id = v_tenant_id
  ) then
    raise exception 'linked_vehicle_scope_mismatch' using errcode = '23514';
  end if;

  update public.ssx_mapping_conflicts conflict
  set external_code = v_external_code,
      observed_plate = v_observed_plate,
      normalized_plate = v_normalized_plate,
      candidate_vehicle_ids = v_candidates,
      linked_vehicle_id = v_linked_vehicle_id,
      last_observed_at = clock_timestamp(),
      occurrence_count = conflict.occurrence_count + 1,
      updated_at = clock_timestamp()
  where conflict.tenant_id = v_tenant_id
    and conflict.integration_account_id = v_account_id
    and conflict.provider_unit_id = v_unit_id
    and conflict.conflict_type = v_type
    and conflict.status = 'open'
  returning conflict.id into v_id;

  if v_id is null then
    insert into public.ssx_mapping_conflicts (
      tenant_id, integration_account_id, provider_unit_id, external_code,
      observed_plate, normalized_plate, conflict_type, candidate_vehicle_ids,
      linked_vehicle_id
    ) values (
      v_tenant_id, v_account_id, v_unit_id, v_external_code,
      v_observed_plate, v_normalized_plate, v_type, v_candidates,
      v_linked_vehicle_id
    )
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.report_ssx_mapping_conflict_v1(jsonb) from public, anon, authenticated;
grant execute on function public.report_ssx_mapping_conflict_v1(jsonb) to service_role;

create or replace function public.list_ssx_mapping_conflicts_v1(
  _tenant_id uuid,
  _status text default 'open',
  _limit integer default 100,
  _offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _status not in ('open','resolved','all') or _limit not between 1 and 200 or _offset < 0 then
    raise exception 'invalid_conflict_query' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row_payload order by due_at, first_observed_at), '[]'::jsonb)
  into v_result
  from (
    select
      conflict.due_at,
      conflict.first_observed_at,
      to_jsonb(conflict) || jsonb_build_object(
        'candidate_vehicles', coalesce((
          select jsonb_agg(jsonb_build_object('id', vehicle.id, 'plate', vehicle.plate, 'nickname', vehicle.nickname)
            order by vehicle.plate, vehicle.id)
          from public.vehicles vehicle
          where vehicle.id = any(conflict.candidate_vehicle_ids)
            and vehicle.tenant_id = conflict.tenant_id
        ), '[]'::jsonb),
        'linked_vehicle', (
          select jsonb_build_object('id', vehicle.id, 'plate', vehicle.plate, 'nickname', vehicle.nickname)
          from public.vehicles vehicle where vehicle.id = conflict.linked_vehicle_id
        )
      ) as row_payload
    from public.ssx_mapping_conflicts conflict
    where conflict.tenant_id = _tenant_id
      and (_status = 'all' or conflict.status = _status)
    order by conflict.due_at, conflict.first_observed_at
    limit _limit offset _offset
  ) rows;
  return v_result;
end;
$function$;

revoke all on function public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer) from public, anon;
grant execute on function public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer) to authenticated;

create or replace function public.resolve_ssx_mapping_conflict_v1(
  _conflict_id uuid,
  _vehicle_id uuid,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_conflict public.ssx_mapping_conflicts%rowtype;
  v_unit_link public.vehicle_tracker_links%rowtype;
  v_vehicle_link public.vehicle_tracker_links%rowtype;
  v_link_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_reason,''))) < 3 then
    raise exception 'resolution_reason_required' using errcode = '22023';
  end if;

  select * into v_conflict
  from public.ssx_mapping_conflicts
  where id = _conflict_id
  for update;
  if not found then raise exception 'mapping_conflict_not_found' using errcode = 'P0002'; end if;
  if not public.is_tenant_operator_or_admin(v_conflict.tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_conflict.status <> 'open' then
    raise exception 'mapping_conflict_already_resolved' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.vehicles vehicle
    where vehicle.id = _vehicle_id and vehicle.tenant_id = v_conflict.tenant_id and vehicle.active
  ) then
    raise exception 'active_vehicle_not_found' using errcode = '23514';
  end if;

  perform 1 from public.provider_units unit
  where unit.id = v_conflict.provider_unit_id and unit.tenant_id = v_conflict.tenant_id
  for update;
  if not found then raise exception 'provider_unit_not_found' using errcode = 'P0002'; end if;

  select * into v_unit_link from public.vehicle_tracker_links link
  where link.tenant_id = v_conflict.tenant_id
    and link.provider_unit_id = v_conflict.provider_unit_id and link.active
  for update;
  select * into v_vehicle_link from public.vehicle_tracker_links link
  where link.tenant_id = v_conflict.tenant_id
    and link.vehicle_id = _vehicle_id and link.active
  for update;

  if v_vehicle_link.id is not null and v_vehicle_link.provider_unit_id <> v_conflict.provider_unit_id then
    raise exception 'vehicle_already_linked_to_another_unit' using errcode = '23505';
  end if;

  if v_unit_link.id is not null and v_unit_link.vehicle_id = _vehicle_id then
    v_link_id := v_unit_link.id;
  else
    if v_unit_link.id is not null then
      update public.vehicle_tracker_links
      set active = false, end_at = clock_timestamp()
      where id = v_unit_link.id;
    end if;
    insert into public.vehicle_tracker_links (tenant_id, vehicle_id, provider_unit_id, active)
    values (v_conflict.tenant_id, _vehicle_id, v_conflict.provider_unit_id, true)
    returning id into v_link_id;
  end if;

  update public.ssx_mapping_conflicts
  set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = auth.uid(),
      resolution_reason = btrim(_reason), resolved_vehicle_id = _vehicle_id,
      updated_at = clock_timestamp()
  where id = v_conflict.id;

  return jsonb_build_object('conflict_id',v_conflict.id,'tracker_link_id',v_link_id,'vehicle_id',_vehicle_id);
end;
$function$;

revoke all on function public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text) from public, anon;
grant execute on function public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text) to authenticated;

comment on table public.ssx_mapping_conflicts is
  'Durable SSX mapping review queue. Open conflicts have a four-hour operational SLA and require an audited manual resolution.';

do $postcondition$
begin
  if not pg_catalog.has_table_privilege('service_role','public.ssx_mapping_conflicts','select,insert,update')
    or pg_catalog.has_table_privilege('authenticated','public.ssx_mapping_conflicts','select')
    or pg_catalog.has_table_privilege('anon','public.ssx_mapping_conflicts','select')
    or pg_catalog.has_function_privilege('authenticated','public.report_ssx_mapping_conflict_v1(jsonb)','execute')
    or not pg_catalog.has_function_privilege('authenticated','public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)','execute')
    or not pg_catalog.has_function_privilege('authenticated','public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)','execute') then
    raise exception 'ssx_mapping_conflict_review_postcondition_failed';
  end if;
end;
$postcondition$;
