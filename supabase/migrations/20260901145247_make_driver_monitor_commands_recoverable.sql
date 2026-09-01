-- Canonical command for manual driver-monitor creation and edits.
-- Database-only bookkeeping: no tracking provider or paid API call.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
declare
  v_duplicates bigint;
begin
  if to_regclass('private.driver_monitor_commands') is not null then
    raise exception 'Driver monitor command migration was already applied';
  end if;
  if to_regclass('public.driver_route_monitors') is null
     or to_regclass('public.driver_monitoring_history') is null then
    raise exception 'Driver monitoring aggregate is unavailable';
  end if;
  select count(*) into v_duplicates
    from (
      select tenant_id, lower(btrim(monitor_number))
        from public.driver_route_monitors
       group by tenant_id, lower(btrim(monitor_number))
      having count(*) > 1
    ) duplicated;
  if v_duplicates > 0 then
    raise exception 'Driver monitoring contains duplicate monitor numbers';
  end if;
end;
$guard$;

create schema if not exists private;

alter table public.driver_route_monitors
  add column revision bigint not null default 0,
  add constraint driver_route_monitors_revision_nonnegative
    check (revision >= 0);

create unique index driver_route_monitors_tenant_number_key
  on public.driver_route_monitors (tenant_id, lower(btrim(monitor_number)));

create function private.bump_driver_monitor_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.revision := old.revision + 1;
  return new;
end;
$fn$;

revoke all on function private.bump_driver_monitor_revision()
  from public, anon, authenticated, service_role;

create trigger bump_driver_monitor_revision
before update on public.driver_route_monitors
for each row execute function private.bump_driver_monitor_revision();

create table private.driver_monitor_commands (
  id uuid primary key,
  tenant_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  action text not null check (action in ('create', 'update')),
  monitor_id uuid not null,
  expected_revision bigint,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, actor_id, request_id),
  foreign key (tenant_id, monitor_id)
    references public.driver_route_monitors (tenant_id, id)
    on delete restrict
);

create index driver_monitor_commands_monitor_idx
  on private.driver_monitor_commands (tenant_id, monitor_id, created_at desc);

alter table private.driver_monitor_commands enable row level security;
revoke all on table private.driver_monitor_commands
  from public, anon, authenticated, service_role;

create function private.preserve_driver_monitor_command()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  raise exception 'driver_monitor_command_is_immutable' using errcode = '55000';
end;
$fn$;

revoke all on function private.preserve_driver_monitor_command()
  from public, anon, authenticated, service_role;

create trigger driver_monitor_commands_append_only
before update or delete on private.driver_monitor_commands
for each row execute function private.preserve_driver_monitor_command();

alter table public.driver_monitoring_history
  add column driver_monitor_command_id uuid,
  add column monitor_revision bigint,
  add constraint driver_monitoring_history_revision_nonnegative
    check (monitor_revision is null or monitor_revision >= 0),
  add constraint driver_monitoring_history_command_tenant_fkey
    foreign key (tenant_id, driver_monitor_command_id)
    references private.driver_monitor_commands (tenant_id, id)
    on delete restrict
    deferrable initially deferred;

create unique index driver_monitoring_history_command_key
  on public.driver_monitoring_history (tenant_id, driver_monitor_command_id)
  where driver_monitor_command_id is not null;

create function private.preserve_driver_monitor_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.driver_monitor_command_id is not null
       and (new.monitor_revision is null or new.created_by is null) then
      raise exception 'driver_monitor_history_evidence_required' using errcode = '23514';
    end if;
    return new;
  end if;
  raise exception 'driver_monitor_history_is_append_only' using errcode = '55000';
end;
$fn$;

revoke all on function private.preserve_driver_monitor_history()
  from public, anon, authenticated, service_role;

create trigger preserve_driver_monitor_history
before insert or update or delete on public.driver_monitoring_history
for each row execute function private.preserve_driver_monitor_history();

drop policy if exists dmh_insert on public.driver_monitoring_history;
drop policy if exists dmh_select on public.driver_monitoring_history;
create policy dmh_insert on public.driver_monitoring_history
  for insert to authenticated
  with check (public.is_tenant_operator_or_admin(tenant_id));
create policy dmh_select on public.driver_monitoring_history
  for select to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

create function public.apply_driver_monitor_command(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_request uuid;
  v_action text;
  v_monitor_id uuid;
  v_command_id uuid := gen_random_uuid();
  v_expected_revision bigint;
  v_payload_hash text;
  v_changes jsonb;
  v_reason text;
  v_previous private.driver_monitor_commands%rowtype;
  v_old public.driver_route_monitors%rowtype;
  v_new public.driver_route_monitors%rowtype;
  v_conflict uuid;
  v_monitor_number text;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_load_id uuid;
  v_driver_name text;
  v_vehicle_plate text;
  v_planned_route text;
  v_planned_cities jsonb;
  v_started_at timestamptz;
  v_expected_return date;
  v_return_days integer;
  v_total integer;
  v_notes text;
  v_status text;
  v_returned_at timestamptz;
  v_history_action text;
  v_response jsonb;
begin
  if jsonb_typeof(_payload) is distinct from 'object'
     or octet_length(_payload::text) > 30000
     or _payload->'version' is distinct from '1'::jsonb
     or exists (
       select 1 from jsonb_object_keys(_payload) key
       where key not in (
         'version', 'tenant_id', 'actor_id', 'request_id', 'action',
         'monitor_id', 'expected_revision', 'reason', 'changes'
       )
     ) then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end if;

  begin
    v_tenant := (_payload->>'tenant_id')::uuid;
    v_request := (_payload->>'request_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end;

  v_action := _payload->>'action';
  v_changes := _payload->'changes';
  if v_actor is null
     or _payload->>'actor_id' is distinct from v_actor::text
     or v_tenant is null
     or not coalesce(public.is_tenant_operator_or_admin(v_tenant), false) then
    raise exception 'driver_monitor_not_authorized' using errcode = '42501';
  end if;
  if v_request is null
     or v_action not in ('create', 'update')
     or jsonb_typeof(v_changes) is distinct from 'object'
     or octet_length(v_changes::text) > 20000
     or exists (
       select 1 from jsonb_object_keys(v_changes) key
       where key not in (
         'monitor_number', 'driver_id', 'vehicle_id', 'load_id',
         'driver_name_snapshot', 'vehicle_plate_snapshot',
         'planned_route_text', 'planned_cities', 'started_at',
         'expected_return_date', 'return_deadline_days', 'total_deliveries',
         'notes', 'status', 'actual_returned_at'
       )
     )
     or jsonb_typeof(_payload->'reason') not in ('string', 'null')
     or length(_payload->>'reason') > 2000 then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end if;

  if v_action = 'create' then
    if jsonb_typeof(_payload->'monitor_id') not in ('null')
       or jsonb_typeof(_payload->'expected_revision') not in ('null')
       or not (v_changes ? 'driver_name_snapshot')
       or not (v_changes ? 'started_at')
       or not (v_changes ? 'total_deliveries') then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end if;
    v_monitor_id := gen_random_uuid();
  else
    begin
      v_monitor_id := (_payload->>'monitor_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end;
    if v_monitor_id is null
       or jsonb_typeof(_payload->'expected_revision') is distinct from 'number'
       or (_payload->>'expected_revision') !~ '^[0-9]+$'
       or (_payload->>'expected_revision')::numeric > 9223372036854775807
       or v_changes = '{}'::jsonb then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end if;
    begin
      v_expected_revision := (_payload->>'expected_revision')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end;
  end if;

  v_reason := nullif(btrim(_payload->>'reason'), '');
  v_payload_hash := encode(sha256(convert_to((_payload - 'request_id')::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(
    hashtext('driver-monitor-command'),
    hashtext(v_tenant::text)
  );

  perform tenant_id
    from public.tenant_memberships
   where tenant_id = v_tenant
     and user_id = v_actor
     and active
     and role::text in ('owner', 'admin', 'operator')
   for share nowait;
  if not found then
    raise exception 'driver_monitor_not_authorized' using errcode = '42501';
  end if;

  select * into v_previous
    from private.driver_monitor_commands
   where tenant_id = v_tenant
     and actor_id = v_actor
     and request_id = v_request;
  if found then
    if v_previous.payload_hash <> v_payload_hash then
      raise exception 'driver_monitor_request_key_mismatch' using errcode = '22023';
    end if;
    return v_previous.response;
  end if;

  if v_action = 'update' then
    select * into v_old
      from public.driver_route_monitors
     where tenant_id = v_tenant and id = v_monitor_id
     for update nowait;
    if not found then
      raise exception 'driver_monitor_not_found' using errcode = '23514';
    end if;
    if v_old.revision <> v_expected_revision then
      raise exception 'driver_monitor_revision_conflict' using errcode = '40001';
    end if;
  end if;

  v_monitor_number := case
    when v_action = 'create' then coalesce(nullif(btrim(v_changes->>'monitor_number'), ''),
      'MON-' || upper(right(replace(v_request::text, '-', ''), 12)))
    when v_changes ? 'monitor_number' then nullif(btrim(v_changes->>'monitor_number'), '')
    else v_old.monitor_number
  end;
  v_driver_id := case when v_changes ? 'driver_id'
    then null else case when v_action = 'update' then v_old.driver_id else null end end;
  v_vehicle_id := case when v_changes ? 'vehicle_id'
    then null else case when v_action = 'update' then v_old.vehicle_id else null end end;
  v_load_id := case when v_changes ? 'load_id'
    then null else case when v_action = 'update' then v_old.load_id else null end end;

  begin
    if v_changes ? 'driver_id' and jsonb_typeof(v_changes->'driver_id') <> 'null' then
      v_driver_id := (v_changes->>'driver_id')::uuid;
    end if;
    if v_changes ? 'vehicle_id' and jsonb_typeof(v_changes->'vehicle_id') <> 'null' then
      v_vehicle_id := (v_changes->>'vehicle_id')::uuid;
    end if;
    if v_changes ? 'load_id' and jsonb_typeof(v_changes->'load_id') <> 'null' then
      v_load_id := (v_changes->>'load_id')::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end;

  if (v_changes ? 'driver_id' and jsonb_typeof(v_changes->'driver_id') not in ('string', 'null'))
     or (v_changes ? 'vehicle_id' and jsonb_typeof(v_changes->'vehicle_id') not in ('string', 'null'))
     or (v_changes ? 'load_id' and jsonb_typeof(v_changes->'load_id') not in ('string', 'null'))
     or (v_changes ? 'monitor_number' and jsonb_typeof(v_changes->'monitor_number') not in ('string', 'null'))
     or (v_changes ? 'driver_name_snapshot' and jsonb_typeof(v_changes->'driver_name_snapshot') not in ('string', 'null'))
     or (v_changes ? 'vehicle_plate_snapshot' and jsonb_typeof(v_changes->'vehicle_plate_snapshot') not in ('string', 'null'))
     or (v_changes ? 'planned_route_text' and jsonb_typeof(v_changes->'planned_route_text') not in ('string', 'null'))
     or (v_changes ? 'notes' and jsonb_typeof(v_changes->'notes') not in ('string', 'null'))
     or (v_changes ? 'status' and jsonb_typeof(v_changes->'status') not in ('string', 'null')) then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end if;

  v_driver_name := case when v_changes ? 'driver_name_snapshot'
    then nullif(btrim(v_changes->>'driver_name_snapshot'), '')
    else case when v_action = 'update' then v_old.driver_name_snapshot else null end end;
  v_vehicle_plate := case when v_changes ? 'vehicle_plate_snapshot'
    then nullif(upper(btrim(v_changes->>'vehicle_plate_snapshot')), '')
    else case when v_action = 'update' then v_old.vehicle_plate_snapshot else null end end;
  v_planned_route := case when v_changes ? 'planned_route_text'
    then nullif(btrim(v_changes->>'planned_route_text'), '')
    else case when v_action = 'update' then v_old.planned_route_text else null end end;
  v_notes := case when v_changes ? 'notes'
    then nullif(btrim(v_changes->>'notes'), '')
    else case when v_action = 'update' then v_old.notes else null end end;

  if v_changes ? 'planned_cities' then
    if jsonb_typeof(v_changes->'planned_cities') is distinct from 'array'
       or jsonb_array_length(v_changes->'planned_cities') > 200
       or exists (
         select 1 from jsonb_array_elements(v_changes->'planned_cities') item
          where jsonb_typeof(item) <> 'string'
             or length(btrim(item #>> '{}')) not between 1 and 200
       ) then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end if;
    v_planned_cities := v_changes->'planned_cities';
  else
    v_planned_cities := case when v_action = 'update' then v_old.planned_cities else '[]'::jsonb end;
  end if;

  begin
    v_started_at := case when v_changes ? 'started_at'
      then (v_changes->>'started_at')::timestamptz
      else case when v_action = 'update' then v_old.started_at else null end end;
    v_expected_return := case when v_changes ? 'expected_return_date'
      and jsonb_typeof(v_changes->'expected_return_date') <> 'null'
      then (v_changes->>'expected_return_date')::date
      else case
        when v_changes ? 'expected_return_date' then null
        when v_action = 'update' then v_old.expected_return_date
        else null
      end end;
    v_returned_at := case when v_changes ? 'actual_returned_at'
      and jsonb_typeof(v_changes->'actual_returned_at') <> 'null'
      then (v_changes->>'actual_returned_at')::timestamptz
      else case
        when v_changes ? 'actual_returned_at' then null
        when v_action = 'update' then v_old.actual_returned_at
        else null
      end end;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end;

  if (v_changes ? 'started_at' and jsonb_typeof(v_changes->'started_at') <> 'string')
     or (v_changes ? 'expected_return_date'
         and jsonb_typeof(v_changes->'expected_return_date') not in ('string', 'null'))
     or (v_changes ? 'actual_returned_at'
         and jsonb_typeof(v_changes->'actual_returned_at') not in ('string', 'null')) then
    raise exception 'driver_monitor_invalid_command' using errcode = '22023';
  end if;

  if v_changes ? 'total_deliveries' then
    if jsonb_typeof(v_changes->'total_deliveries') is distinct from 'number'
       or (v_changes->>'total_deliveries') !~ '^[0-9]+$'
       or (v_changes->>'total_deliveries')::numeric > 1000000 then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    end if;
    v_total := (v_changes->>'total_deliveries')::integer;
  else
    v_total := case when v_action = 'update' then v_old.total_deliveries else 0 end;
  end if;

  if v_changes ? 'return_deadline_days' then
    if jsonb_typeof(v_changes->'return_deadline_days') = 'null' then
      v_return_days := null;
    elsif jsonb_typeof(v_changes->'return_deadline_days') is distinct from 'number'
       or (v_changes->>'return_deadline_days') !~ '^[0-9]+$'
       or (v_changes->>'return_deadline_days')::numeric > 3650 then
      raise exception 'driver_monitor_invalid_command' using errcode = '22023';
    else
      v_return_days := (v_changes->>'return_deadline_days')::integer;
    end if;
  else
    v_return_days := case when v_action = 'update' then v_old.return_deadline_days else null end;
  end if;

  v_status := case
    when v_action = 'create' then 'active'
    when v_changes ? 'status' then v_changes->>'status'
    else v_old.status
  end;

  if v_monitor_number is null or length(v_monitor_number) > 80
     or v_driver_name is null or length(v_driver_name) > 200
     or length(v_vehicle_plate) > 32
     or length(v_planned_route) > 8000
     or length(v_notes) > 4000
     or v_started_at is null or not isfinite(v_started_at)
     or (v_expected_return is not null and (
       not isfinite(v_expected_return)
       or v_expected_return < (v_started_at at time zone 'America/Sao_Paulo')::date
     ))
     or (v_returned_at is not null and (
       not isfinite(v_returned_at) or v_returned_at < v_started_at
     ))
     or v_total < (case when v_action = 'update' then v_old.completed_deliveries else 0 end)
     or v_status not in (
       'active', 'on_time', 'delayed', 'no_update', 'returning',
       'arrived', 'completed', 'waiting_load', 'cancelled', 'issue'
     )
     or (v_status in ('arrived', 'completed') and v_returned_at is null)
     or (v_status not in ('arrived', 'completed', 'cancelled') and v_returned_at is not null)
     or (v_action = 'update'
         and v_old.status in ('arrived', 'completed', 'cancelled')
         and v_status <> v_old.status) then
    raise exception 'driver_monitor_invalid_state' using errcode = '23514';
  end if;

  if v_driver_id is not null then
    select name into v_driver_name
      from public.drivers
     where tenant_id = v_tenant and id = v_driver_id
     for share nowait;
    if not found then
      raise exception 'driver_monitor_invalid_driver' using errcode = '23514';
    end if;
  end if;
  if v_vehicle_id is not null then
    select plate into v_vehicle_plate
      from public.vehicles
     where tenant_id = v_tenant and id = v_vehicle_id
     for share nowait;
    if not found then
      raise exception 'driver_monitor_invalid_vehicle' using errcode = '23514';
    end if;
  end if;
  if v_load_id is not null then
    perform id from public.loads
     where tenant_id = v_tenant and id = v_load_id
     for share nowait;
    if not found then
      raise exception 'driver_monitor_invalid_load' using errcode = '23514';
    end if;
  end if;

  perform id
    from public.driver_route_monitors m
   where m.tenant_id = v_tenant
     and m.id <> v_monitor_id
     and m.status not in ('arrived', 'completed', 'cancelled')
     and coalesce(m.started_at, '-infinity'::timestamptz)
         < coalesce(
           v_returned_at,
           ((v_expected_return + 1)::timestamp at time zone 'America/Sao_Paulo'),
           'infinity'::timestamptz
         )
     and v_started_at
         < coalesce(
           m.actual_returned_at,
           ((m.expected_return_date + 1)::timestamp at time zone 'America/Sao_Paulo'),
           'infinity'::timestamptz
         )
     and (
       (v_driver_id is not null and m.driver_id = v_driver_id)
       or (v_driver_id is null and m.driver_id is null
           and lower(btrim(m.driver_name_snapshot)) = lower(btrim(v_driver_name)))
       or (v_vehicle_id is not null and m.vehicle_id = v_vehicle_id)
       or (v_vehicle_id is null and v_vehicle_plate is not null and m.vehicle_id is null
           and upper(regexp_replace(m.vehicle_plate_snapshot, '[^A-Z0-9]', '', 'g'))
             = upper(regexp_replace(v_vehicle_plate, '[^A-Z0-9]', '', 'g')))
       or (v_load_id is not null and m.load_id = v_load_id)
     )
   limit 1
   for update nowait;
  if found and v_status not in ('arrived', 'completed', 'cancelled') then
    raise exception 'driver_monitor_overlap' using errcode = '23P01';
  end if;

  perform id
    from public.driver_route_monitors
   where tenant_id = v_tenant
     and id <> v_monitor_id
     and lower(btrim(monitor_number)) = lower(btrim(v_monitor_number))
   limit 1;
  if found then
    raise exception 'driver_monitor_duplicate_number' using errcode = '23505';
  end if;

  if v_action = 'create' then
    insert into public.driver_route_monitors (
      id, tenant_id, driver_id, vehicle_id, load_id, monitor_number,
      driver_name_snapshot, vehicle_plate_snapshot, planned_route_text,
      planned_cities, started_at, expected_return_date, return_deadline_days,
      total_deliveries, completed_deliveries, remaining_deliveries,
      status, notes, source_type, created_by, updated_by
    ) values (
      v_monitor_id, v_tenant, v_driver_id, v_vehicle_id, v_load_id, v_monitor_number,
      v_driver_name, v_vehicle_plate, v_planned_route, v_planned_cities,
      v_started_at, v_expected_return, v_return_days,
      v_total, 0, v_total, v_status, v_notes, 'manual', v_actor, v_actor
    ) returning * into v_new;
    v_history_action := 'created';
  else
    update public.driver_route_monitors
       set driver_id = v_driver_id,
           vehicle_id = v_vehicle_id,
           load_id = v_load_id,
           monitor_number = v_monitor_number,
           driver_name_snapshot = v_driver_name,
           vehicle_plate_snapshot = v_vehicle_plate,
           planned_route_text = v_planned_route,
           planned_cities = v_planned_cities,
           started_at = v_started_at,
           expected_return_date = v_expected_return,
           return_deadline_days = v_return_days,
           total_deliveries = v_total,
           remaining_deliveries = greatest(0, v_total - completed_deliveries),
           status = v_status,
           actual_returned_at = v_returned_at,
           notes = v_notes,
           updated_by = v_actor,
           updated_at = clock_timestamp()
     where tenant_id = v_tenant and id = v_monitor_id
     returning * into v_new;
    v_history_action := case when v_new.status is distinct from v_old.status
      then 'status_changed' else 'updated' end;
  end if;

  v_response := jsonb_build_object(
    'version', 1,
    'tenant_id', v_tenant,
    'actor_id', v_actor,
    'request_id', v_request,
    'action', v_action,
    'confirmed', true,
    'command_id', v_command_id,
    'monitor_id', v_new.id,
    'monitor_number', v_new.monitor_number,
    'status', v_new.status,
    'revision', v_new.revision,
    'updated_at', v_new.updated_at
  );

  insert into public.driver_monitoring_history (
    tenant_id, monitor_id, action, field_name, old_value, new_value,
    reason, metadata, created_by, driver_monitor_command_id, monitor_revision
  ) values (
    v_tenant, v_new.id, v_history_action,
    case when v_history_action = 'status_changed' then 'status' else null end,
    case when v_action = 'update' then jsonb_build_object(
      'monitor_number', v_old.monitor_number,
      'driver_id', v_old.driver_id,
      'vehicle_id', v_old.vehicle_id,
      'load_id', v_old.load_id,
      'planned_route_text', v_old.planned_route_text,
      'planned_cities', v_old.planned_cities,
      'started_at', v_old.started_at,
      'expected_return_date', v_old.expected_return_date,
      'return_deadline_days', v_old.return_deadline_days,
      'total_deliveries', v_old.total_deliveries,
      'status', v_old.status,
      'actual_returned_at', v_old.actual_returned_at,
      'notes', v_old.notes
    )::text else null end,
    jsonb_build_object(
      'monitor_number', v_new.monitor_number,
      'driver_id', v_new.driver_id,
      'vehicle_id', v_new.vehicle_id,
      'load_id', v_new.load_id,
      'planned_route_text', v_new.planned_route_text,
      'planned_cities', v_new.planned_cities,
      'started_at', v_new.started_at,
      'expected_return_date', v_new.expected_return_date,
      'return_deadline_days', v_new.return_deadline_days,
      'total_deliveries', v_new.total_deliveries,
      'status', v_new.status,
      'actual_returned_at', v_new.actual_returned_at,
      'notes', v_new.notes
    )::text,
    v_reason,
    jsonb_build_object(
      'request_id', v_request,
      'command_id', v_command_id,
      'actor_id', v_actor,
      'revision', v_new.revision,
      'changes', v_changes
    ),
    v_actor, v_command_id, v_new.revision
  );

  insert into private.driver_monitor_commands (
    id, tenant_id, actor_id, request_id, action, monitor_id,
    expected_revision, payload_hash, response
  ) values (
    v_command_id, v_tenant, v_actor, v_request, v_action, v_new.id,
    v_expected_revision, v_payload_hash, v_response
  );

  return v_response;
exception
  when lock_not_available then
    raise exception 'driver_monitor_concurrent_change' using errcode = '40001';
end;
$fn$;

comment on function public.apply_driver_monitor_command(jsonb) is
  'Canonical, idempotent command for manual driver monitor creation and edits.';

revoke all on function public.apply_driver_monitor_command(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_driver_monitor_command(jsonb) to authenticated;
