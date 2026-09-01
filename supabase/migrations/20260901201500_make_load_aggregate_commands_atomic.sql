-- Canonical, atomic commands for operator-owned load aggregate mutations.
-- Legacy load mutation RPCs remain available until every caller is cut over.

create schema if not exists private;

do $$
begin
  if exists (
    select 1
      from public.loads l
      join public.drivers d on d.id = l.driver_id
     where d.tenant_id <> l.tenant_id
  ) then
    raise exception 'Cannot harden loads.driver_id: cross-tenant rows exist';
  end if;

  if exists (
    select 1
      from public.loads l
      join public.vehicles v on v.id = l.vehicle_id
     where v.tenant_id <> l.tenant_id
  ) then
    raise exception 'Cannot harden loads.vehicle_id: cross-tenant rows exist';
  end if;

  if exists (
    select 1
      from public.loads l
      join public.dispatch_trips t on t.id = l.trip_id
     where t.tenant_id <> l.tenant_id
  ) then
    raise exception 'Cannot harden loads.trip_id: cross-tenant rows exist';
  end if;
end;
$$;

create unique index if not exists drivers_tenant_id_id_uidx
  on public.drivers (tenant_id, id);
create unique index if not exists vehicles_tenant_id_id_uidx
  on public.vehicles (tenant_id, id);
create unique index if not exists dispatch_trips_tenant_id_id_uidx
  on public.dispatch_trips (tenant_id, id);

alter table public.loads
  drop constraint if exists loads_driver_id_fkey;
alter table public.loads
  drop constraint if exists loads_tenant_driver_fkey;
alter table public.loads
  add constraint loads_tenant_driver_fkey
  foreign key (tenant_id, driver_id)
  references public.drivers (tenant_id, id)
  on delete set null (driver_id);

alter table public.loads
  drop constraint if exists loads_vehicle_id_fkey;
alter table public.loads
  drop constraint if exists loads_tenant_vehicle_fkey;
alter table public.loads
  add constraint loads_tenant_vehicle_fkey
  foreign key (tenant_id, vehicle_id)
  references public.vehicles (tenant_id, id)
  on delete set null (vehicle_id);

alter table public.loads
  drop constraint if exists loads_trip_id_fkey;
alter table public.loads
  drop constraint if exists loads_tenant_trip_fkey;
alter table public.loads
  add constraint loads_tenant_trip_fkey
  foreign key (tenant_id, trip_id)
  references public.dispatch_trips (tenant_id, id)
  on delete set null (trip_id);

create or replace function private.bump_load_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if row(
    new.load_number,new.vehicle_id,new.driver_id,new.origin,new.destination,
    new.total_pallet_count,new.total_weight_kg,new.total_volume_m3,new.status,new.trip_id,
    new.notes,new.operation_type,new.distribution_manifest,new.shipment_manifest,
    new.scheduled_load_at,new.actual_load_at,new.trailer_plate,new.merchandise_value,new.ciot,
    new.gate_departure_at,new.arrival_at,new.estimated_arrival_at,new.payment_method,
    new.on_hold,new.hold_reason,new.held_at,new.held_by
  ) is distinct from row(
    old.load_number,old.vehicle_id,old.driver_id,old.origin,old.destination,
    old.total_pallet_count,old.total_weight_kg,old.total_volume_m3,old.status,old.trip_id,
    old.notes,old.operation_type,old.distribution_manifest,old.shipment_manifest,
    old.scheduled_load_at,old.actual_load_at,old.trailer_plate,old.merchandise_value,old.ciot,
    old.gate_departure_at,old.arrival_at,old.estimated_arrival_at,old.payment_method,
    old.on_hold,old.hold_reason,old.held_at,old.held_by
  ) then
    new.version := greatest(coalesce(new.version, old.version), old.version + 1);
  elsif new.version < old.version then
    raise exception 'load_revision_cannot_decrease' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_load_revision on public.loads;
create trigger trg_bump_load_revision
before update on public.loads
for each row
execute function private.bump_load_revision();

create table if not exists private.load_aggregate_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  action text not null check (action in ('create', 'update', 'hold', 'unhold', 'delete', 'delete_many')),
  payload_hash text not null,
  payload jsonb not null,
  before_state jsonb not null default '[]'::jsonb,
  after_state jsonb not null default '[]'::jsonb,
  response jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (tenant_id, actor_id, request_id)
);

alter table private.load_aggregate_commands enable row level security;
revoke all on table private.load_aggregate_commands from public, anon, authenticated;
revoke all on function private.bump_load_revision() from public, anon, authenticated;

create or replace function private.load_command_snapshot(
  p_tenant_id uuid,
  p_load_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
    from public.loads l
   where l.tenant_id = p_tenant_id
     and l.id = any(p_load_ids);
$$;

revoke all on function private.load_command_snapshot(uuid, uuid[])
  from public, anon, authenticated;

create or replace function private.insert_load_from_json(p_row jsonb)
returns public.loads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_columns text;
  v_values text;
  v_result public.loads;
begin
  select string_agg(format('%I', k), ', ' order by k),
         string_agg(format('r.%I', k), ', ' order by k)
    into v_columns, v_values
    from jsonb_object_keys(p_row) k;

  execute format(
    'insert into public.loads (%s) select %s from jsonb_populate_record(null::public.loads, $1) r returning *',
    v_columns,
    v_values
  ) using p_row into v_result;
  return v_result;
end;
$$;

create or replace function private.update_load_from_json(
  p_tenant_id uuid,
  p_load_id uuid,
  p_changes jsonb
)
returns public.loads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assignments text;
  v_result public.loads;
begin
  select string_agg(format('%1$I = r.%1$I', k), ', ' order by k)
    into v_assignments
    from jsonb_object_keys(p_changes) k;

  if v_assignments is null then
    raise exception 'changes cannot be empty' using errcode = '22023';
  end if;

  execute format(
    'update public.loads l set %s from jsonb_populate_record(null::public.loads, $1) r where l.tenant_id = $2 and l.id = $3 returning l.*',
    v_assignments
  ) using p_changes, p_tenant_id, p_load_id into v_result;
  return v_result;
end;
$$;

revoke all on function private.insert_load_from_json(jsonb)
  from public, anon, authenticated;
revoke all on function private.update_load_from_json(uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.apply_load_aggregate_command(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid;
  v_request_id uuid;
  v_action text;
  v_reason text;
  v_changes jsonb := '{}'::jsonb;
  v_hash_payload jsonb;
  v_payload_hash text;
  v_existing private.load_aggregate_commands%rowtype;
  v_allowed_keys constant text[] := array[
    'load_number', 'origin', 'destination', 'notes', 'operation_type',
    'scheduled_load_at', 'estimated_arrival_at', 'trailer_plate', 'ciot',
    'distribution_manifest', 'shipment_manifest', 'driver_id', 'vehicle_id',
    'merchandise_value', 'payment_method'
  ];
  v_allowed_payload_keys text[];
  v_unknown_keys text[];
  v_effective_changes jsonb := '{}'::jsonb;
  v_key text;
  v_load_id uuid;
  v_load_ids uuid[] := array[]::uuid[];
  v_expected_version integer;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_response jsonb;
  v_load public.loads%rowtype;
  v_load_number text;
  v_suffix bigint;
  v_targets jsonb;
  v_target jsonb;
  v_expected_versions jsonb := '{}'::jsonb;
  v_count integer;
  v_row record;
begin
  if v_actor_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if jsonb_typeof(_payload) <> 'object' then
    raise exception 'payload_must_be_object' using errcode = '22023';
  end if;

  begin
    v_tenant_id := (_payload ->> 'tenant_id')::uuid;
    v_request_id := (_payload ->> 'request_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_command_uuid' using errcode = '22023';
  end;
  if v_tenant_id is null or v_request_id is null then
    raise exception 'tenant_and_request_required' using errcode = '22023';
  end if;
  if coalesce((_payload ->> 'schema_version')::integer, 0) <> 1 then
    raise exception 'unsupported_schema_version' using errcode = '22023';
  end if;

  v_action := lower(coalesce(_payload ->> 'action', ''));
  if v_action not in ('create', 'update', 'hold', 'unhold', 'delete', 'delete_many') then
    raise exception 'unsupported_load_action' using errcode = '22023';
  end if;

  v_allowed_payload_keys := case v_action
    when 'create' then array['schema_version','tenant_id','request_id','action','changes','reason']
    when 'update' then array['schema_version','tenant_id','request_id','action','load_id','expected_version','changes','reason']
    when 'delete_many' then array['schema_version','tenant_id','request_id','action','targets','reason']
    else array['schema_version','tenant_id','request_id','action','load_id','expected_version','reason']
  end;
  select coalesce(array_agg(k order by k), array[]::text[])
    into v_unknown_keys
    from jsonb_object_keys(_payload) k
   where not (k = any(v_allowed_payload_keys));
  if cardinality(v_unknown_keys) > 0 then
    raise exception 'unsupported_command_fields:%', array_to_string(v_unknown_keys, ',')
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.tenant_memberships tm
     where tm.tenant_id = v_tenant_id
       and tm.user_id = v_actor_id
       and tm.active
       and tm.role::text in ('owner', 'admin', 'operator')
  ) then
    raise exception 'operator_role_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || v_actor_id::text || ':' || v_request_id::text, 0)
  );

  v_hash_payload := _payload - 'request_id';
  v_payload_hash := encode(digest(convert_to(v_hash_payload::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing
    from private.load_aggregate_commands c
   where c.tenant_id = v_tenant_id
     and c.actor_id = v_actor_id
     and c.request_id = v_request_id;
  if found then
    if v_existing.payload_hash <> v_payload_hash then
      raise exception 'request_payload_mismatch' using errcode = '22023';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  v_reason := btrim(coalesce(_payload ->> 'reason', ''));
  if v_action in ('hold', 'delete', 'delete_many')
     and (length(v_reason) < 5 or length(v_reason) > 500) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if v_action in ('create', 'update') then
    if jsonb_typeof(_payload -> 'changes') <> 'object' then
      raise exception 'changes_must_be_object' using errcode = '22023';
    end if;
    v_changes := _payload -> 'changes';
    select coalesce(array_agg(k order by k), array[]::text[])
      into v_unknown_keys
      from jsonb_object_keys(v_changes) k
     where not (k = any(v_allowed_keys));
    if cardinality(v_unknown_keys) > 0 then
      raise exception 'unsupported_load_fields:%', array_to_string(v_unknown_keys, ',')
        using errcode = '22023';
    end if;
  end if;

  if v_action = 'create' then
    perform pg_advisory_xact_lock(hashtextextended('load-number:' || v_tenant_id::text, 0));

    v_load_number := nullif(btrim(v_changes ->> 'load_number'), '');
    if v_load_number is null then
      select coalesce(max((substring(l.load_number from '([0-9]+)[^0-9]*$'))::bigint), 1000) + 1
        into v_suffix
        from public.loads l
       where l.tenant_id = v_tenant_id
         and substring(l.load_number from '([0-9]+)[^0-9]*$') is not null;
      v_load_number := v_suffix::text;
    end if;

    if exists (
      select 1 from public.loads l
       where l.tenant_id = v_tenant_id and l.load_number = v_load_number
    ) then
      raise exception 'load_number_conflict' using errcode = '23505';
    end if;

    if v_changes ? 'driver_id' and jsonb_typeof(v_changes -> 'driver_id') <> 'null'
       and not exists (
         select 1 from public.drivers d
          where d.id = (v_changes ->> 'driver_id')::uuid
            and d.tenant_id = v_tenant_id and d.active
       ) then
      raise exception 'driver_not_available_for_tenant' using errcode = '23514';
    end if;
    if v_changes ? 'vehicle_id' and jsonb_typeof(v_changes -> 'vehicle_id') <> 'null'
       and not exists (
         select 1 from public.vehicles v
          where v.id = (v_changes ->> 'vehicle_id')::uuid
            and v.tenant_id = v_tenant_id and v.active
            and not coalesce(v.blocked, false)
            and not coalesce(v.in_maintenance, false)
       ) then
      raise exception 'vehicle_not_available_for_tenant' using errcode = '23514';
    end if;

    v_changes := v_changes || jsonb_build_object(
      'id', gen_random_uuid(),
      'tenant_id', v_tenant_id,
      'load_number', v_load_number,
      'status', 'planned',
      'created_by', v_actor_id,
      'version', 1
    );
    v_load := private.insert_load_from_json(v_changes);
    v_load_ids := array[v_load.id];
    v_after := private.load_command_snapshot(v_tenant_id, v_load_ids);
    v_response := jsonb_build_object(
      'ok', true, 'action', v_action, 'load_id', v_load.id,
      'version', v_load.version, 'load', to_jsonb(v_load), 'replayed', false
    );
    perform public._log_entity_audit(
      v_tenant_id, 'load', v_load.id, 'create', '{}'::jsonb,
      to_jsonb(v_load), 'apply_load_aggregate_command'
    );

  elsif v_action = 'update' then
    begin
      v_load_id := (_payload ->> 'load_id')::uuid;
      v_expected_version := (_payload ->> 'expected_version')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_load_or_version' using errcode = '22023';
    end;
    if v_load_id is null or v_expected_version is null then
      raise exception 'load_and_expected_version_required' using errcode = '22023';
    end if;

    perform t.id
      from public.dispatch_trips t
     where t.tenant_id = v_tenant_id
       and (
         t.load_id = v_load_id
         or exists (
           select 1 from public.dispatch_trip_loads link
            where link.dispatch_trip_id = t.id and link.load_id = v_load_id
         )
       )
     order by t.id
     for update nowait;
    perform link.dispatch_trip_id
      from public.dispatch_trip_loads link
     where link.load_id = v_load_id
     order by link.dispatch_trip_id
     for update nowait;
    select * into v_load
      from public.loads l
     where l.id = v_load_id and l.tenant_id = v_tenant_id
     for update nowait;
    if not found then
      raise exception 'load_not_found' using errcode = 'P0002';
    end if;
    if v_load.version <> v_expected_version then
      raise exception 'load_revision_conflict' using errcode = '40001';
    end if;
    if public._load_is_locked(v_load_id) then
      raise exception 'load_header_locked' using errcode = '55000';
    end if;

    v_before := jsonb_build_array(to_jsonb(v_load));
    v_effective_changes := v_changes;
    for v_key in select jsonb_object_keys(v_changes)
    loop
      if (to_jsonb(v_load) -> v_key) is not distinct from (v_changes -> v_key) then
        v_effective_changes := v_effective_changes - v_key;
      end if;
    end loop;

    if exists (
      select 1
        from public.dispatch_trips t
       where t.tenant_id = v_tenant_id
         and t.status not in ('completed', 'cancelled')
         and (
           t.load_id = v_load_id
           or exists (
             select 1 from public.dispatch_trip_loads link
              where link.dispatch_trip_id = t.id and link.load_id = v_load_id
           )
         )
    ) and v_effective_changes ?| array['driver_id', 'vehicle_id', 'origin', 'destination'] then
      raise exception 'active_trip_requires_replanning' using errcode = '55000';
    end if;

    if v_effective_changes ? 'driver_id' and jsonb_typeof(v_effective_changes -> 'driver_id') <> 'null'
       and not exists (
         select 1 from public.drivers d
          where d.id = (v_effective_changes ->> 'driver_id')::uuid
            and d.tenant_id = v_tenant_id and d.active
       ) then
      raise exception 'driver_not_available_for_tenant' using errcode = '23514';
    end if;
    if v_effective_changes ? 'vehicle_id' and jsonb_typeof(v_effective_changes -> 'vehicle_id') <> 'null'
       and not exists (
         select 1 from public.vehicles v
          where v.id = (v_effective_changes ->> 'vehicle_id')::uuid
            and v.tenant_id = v_tenant_id and v.active
            and not coalesce(v.blocked, false)
            and not coalesce(v.in_maintenance, false)
       ) then
      raise exception 'vehicle_not_available_for_tenant' using errcode = '23514';
    end if;

    if v_effective_changes = '{}'::jsonb then
      v_after := v_before;
    else
      v_load := private.update_load_from_json(v_tenant_id, v_load_id, v_effective_changes);
      v_after := jsonb_build_array(to_jsonb(v_load));
      perform public._log_entity_audit(
        v_tenant_id, 'load', v_load_id, 'update', v_before -> 0,
        to_jsonb(v_load), 'apply_load_aggregate_command'
      );
    end if;
    v_response := jsonb_build_object(
      'ok', true, 'action', v_action, 'load_id', v_load_id,
      'version', v_load.version, 'load', to_jsonb(v_load),
      'no_change', v_effective_changes = '{}'::jsonb, 'replayed', false
    );

  elsif v_action in ('hold', 'unhold') then
    begin
      v_load_id := (_payload ->> 'load_id')::uuid;
      v_expected_version := (_payload ->> 'expected_version')::integer;
    exception when invalid_text_representation then
      raise exception 'invalid_load_or_version' using errcode = '22023';
    end;
    if v_load_id is null or v_expected_version is null then
      raise exception 'load_and_expected_version_required' using errcode = '22023';
    end if;

    perform t.id
      from public.dispatch_trips t
     where t.tenant_id = v_tenant_id
       and (
         t.load_id = v_load_id
         or exists (
           select 1 from public.dispatch_trip_loads link
            where link.dispatch_trip_id = t.id and link.load_id = v_load_id
         )
       )
     order by t.id
     for update nowait;
    perform link.dispatch_trip_id
      from public.dispatch_trip_loads link
     where link.load_id = v_load_id
     order by link.dispatch_trip_id
     for update nowait;
    select * into v_load
      from public.loads l
     where l.id = v_load_id and l.tenant_id = v_tenant_id
     for update nowait;
    if not found then
      raise exception 'load_not_found' using errcode = 'P0002';
    end if;
    if v_load.version <> v_expected_version then
      raise exception 'load_revision_conflict' using errcode = '40001';
    end if;
    if public._load_is_locked(v_load_id) then
      raise exception 'load_hold_locked' using errcode = '55000';
    end if;

    v_before := jsonb_build_array(to_jsonb(v_load));
    if (v_action = 'hold' and coalesce(v_load.on_hold, false))
       or (v_action = 'unhold' and not coalesce(v_load.on_hold, false)) then
      v_after := v_before;
      v_response := jsonb_build_object(
        'ok', true, 'action', v_action, 'load_id', v_load_id,
        'version', v_load.version, 'load', to_jsonb(v_load),
        'no_change', true, 'replayed', false
      );
    else
      if v_action = 'hold' then
        update public.loads l
           set on_hold = true,
               hold_reason = v_reason,
               held_at = statement_timestamp(),
               held_by = v_actor_id,
               updated_at = statement_timestamp()
         where l.id = v_load_id and l.tenant_id = v_tenant_id
         returning * into v_load;
      else
        update public.loads l
           set on_hold = false,
               hold_reason = null,
               held_at = null,
               held_by = null,
               updated_at = statement_timestamp()
         where l.id = v_load_id and l.tenant_id = v_tenant_id
         returning * into v_load;
      end if;

      insert into public.load_status_history (
        tenant_id, load_id, field_name, old_value, new_value, reason, created_by
      ) values (
        v_tenant_id, v_load_id, 'on_hold',
        (v_before -> 0 -> 'on_hold')::text, to_jsonb(v_load.on_hold)::text,
        nullif(v_reason, ''), v_actor_id
      );
      v_after := jsonb_build_array(to_jsonb(v_load));
      perform public._log_entity_audit(
        v_tenant_id, 'load', v_load_id, v_action, v_before -> 0,
        to_jsonb(v_load), 'apply_load_aggregate_command'
      );
      v_response := jsonb_build_object(
        'ok', true, 'action', v_action, 'load_id', v_load_id,
        'version', v_load.version, 'load', to_jsonb(v_load),
        'no_change', false, 'replayed', false
      );
    end if;

  elsif v_action in ('delete', 'delete_many') then
    if v_action = 'delete' then
      v_targets := jsonb_build_array(jsonb_build_object(
        'load_id', _payload -> 'load_id',
        'expected_version', _payload -> 'expected_version'
      ));
    else
      v_targets := _payload -> 'targets';
    end if;
    if jsonb_typeof(v_targets) <> 'array'
       or jsonb_array_length(v_targets) < 1
       or jsonb_array_length(v_targets) > 100 then
      raise exception 'delete_targets_required' using errcode = '22023';
    end if;

    for v_target in select value from jsonb_array_elements(v_targets)
    loop
      if jsonb_typeof(v_target) <> 'object' then
        raise exception 'invalid_delete_target' using errcode = '22023';
      end if;
      begin
        v_load_id := (v_target ->> 'load_id')::uuid;
        v_expected_version := (v_target ->> 'expected_version')::integer;
      exception when invalid_text_representation then
        raise exception 'invalid_delete_target' using errcode = '22023';
      end;
      if v_load_id is null or v_expected_version is null or v_expected_version < 1 then
        raise exception 'invalid_delete_target' using errcode = '22023';
      end if;
      if v_load_id = any(v_load_ids) then
        raise exception 'duplicate_delete_target' using errcode = '22023';
      end if;
      v_load_ids := array_append(v_load_ids, v_load_id);
      v_expected_versions := v_expected_versions
        || jsonb_build_object(v_load_id::text, v_expected_version);
    end loop;

    perform t.id
      from public.dispatch_trips t
     where t.tenant_id = v_tenant_id
       and (
         t.load_id = any(v_load_ids)
         or exists (
           select 1 from public.dispatch_trip_loads link
            where link.dispatch_trip_id = t.id and link.load_id = any(v_load_ids)
         )
       )
     order by t.id
     for update nowait;
    perform link.dispatch_trip_id, link.load_id
      from public.dispatch_trip_loads link
     where link.load_id = any(v_load_ids)
     order by link.dispatch_trip_id, link.load_id
     for update nowait;
    perform l.id
      from public.loads l
     where l.tenant_id = v_tenant_id and l.id = any(v_load_ids)
     order by l.id
     for update nowait;
    get diagnostics v_count = row_count;
    if v_count <> cardinality(v_load_ids) then
      raise exception 'load_not_found' using errcode = 'P0002';
    end if;

    v_before := private.load_command_snapshot(v_tenant_id, v_load_ids);
    for v_row in
      select l.* from public.loads l
       where l.tenant_id = v_tenant_id and l.id = any(v_load_ids)
       order by l.id
    loop
      if v_row.version <> (v_expected_versions ->> (v_row.id::text))::integer then
        raise exception 'load_revision_conflict:%', v_row.id using errcode = '40001';
      end if;
      if v_row.status not in ('planned', 'assembling', 'ready')
         or v_row.trip_id is not null
         or public._load_is_locked(v_row.id) then
        raise exception 'load_delete_state_locked:%', v_row.id using errcode = '55000';
      end if;
      if v_row.receivable_id is not null
         or v_row.client_invoice_id is not null
         or v_row.doccob_export_id is not null
         or v_row.closing_report_id is not null
         or exists (select 1 from public.dispatch_trip_loads x where x.load_id = v_row.id)
         or exists (select 1 from public.dispatch_trips x where x.load_id = v_row.id)
         or exists (select 1 from public.load_items x where x.load_id = v_row.id)
         or exists (select 1 from public.fiscal_documents x where x.load_id = v_row.id)
         or exists (select 1 from public.load_payments x where x.load_id = v_row.id)
         or exists (select 1 from public.driver_settlement_loads x where x.load_id = v_row.id)
         or exists (select 1 from public.closing_report_items x where x.load_id = v_row.id)
         or exists (select 1 from public.load_unloading_charges x where x.load_id = v_row.id)
         or exists (select 1 from public.payables x where x.load_id = v_row.id) then
        raise exception 'load_delete_has_dependencies:%', v_row.id using errcode = '23503';
      end if;
    end loop;

    for v_row in select value row_json from jsonb_array_elements(v_before) order by value ->> 'id'
    loop
      perform public._log_entity_audit(
        v_tenant_id, 'load', (v_row.row_json ->> 'id')::uuid, 'delete',
        v_row.row_json, '{}'::jsonb, 'apply_load_aggregate_command'
      );
    end loop;
    delete from public.loads l
     where l.tenant_id = v_tenant_id and l.id = any(v_load_ids);
    v_after := '[]'::jsonb;
    v_response := jsonb_build_object(
      'ok', true, 'action', v_action, 'deleted_load_ids', to_jsonb(v_load_ids),
      'replayed', false
    );
  end if;

  insert into private.load_aggregate_commands (
    tenant_id, actor_id, request_id, action, payload_hash, payload,
    before_state, after_state, response
  ) values (
    v_tenant_id, v_actor_id, v_request_id, v_action, v_payload_hash,
    _payload, v_before, v_after, v_response
  );
  return v_response;

exception
  when lock_not_available or deadlock_detected then
    raise exception 'load_concurrent_change' using errcode = '40001';
end;
$$;

revoke all on function public.apply_load_aggregate_command(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_load_aggregate_command(jsonb)
  to authenticated;
