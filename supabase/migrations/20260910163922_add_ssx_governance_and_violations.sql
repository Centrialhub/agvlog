-- SSX governance snapshots and rule-violation ingestion foundations.
-- All objects in this migration are backend-only. The browser does not need
-- direct access to raw SSX governance or driver violation payloads.

alter table public.positions_raw
  add column if not exists provider_position_id bigint;

alter table public.positions_raw
  drop constraint if exists positions_raw_provider_position_id_positive;
alter table public.positions_raw
  add constraint positions_raw_provider_position_id_positive
  check (provider_position_id is null or provider_position_id > 0);

create or replace function ssx_private.populate_provider_position_id_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_value text;
begin
  if new.provider_position_id is not null then
    return new;
  end if;

  v_value := coalesce(new.telemetry->>'IdPosition', new.telemetry->>'idPosition');
  if v_value is not null
     and v_value ~ '^[1-9][0-9]{0,18}$'
     and v_value::numeric <= 9223372036854775807 then
    new.provider_position_id := v_value::bigint;
  end if;
  return new;
end
$function$;

revoke all on function ssx_private.populate_provider_position_id_v1()
  from public, anon, authenticated;

drop trigger if exists positions_raw_provider_position_id_v1 on public.positions_raw;
create trigger positions_raw_provider_position_id_v1
before insert or update of telemetry, provider_position_id on public.positions_raw
for each row execute function ssx_private.populate_provider_position_id_v1();

update public.positions_raw
set provider_position_id = coalesce(telemetry->>'IdPosition', telemetry->>'idPosition')::bigint
where provider_position_id is null
  and coalesce(telemetry->>'IdPosition', telemetry->>'idPosition') ~ '^[1-9][0-9]{0,18}$'
  and coalesce(telemetry->>'IdPosition', telemetry->>'idPosition')::numeric <= 9223372036854775807;

create index if not exists positions_raw_ssx_position_cursor_idx
  on public.positions_raw (integration_account_id, provider_position_id desc)
  where integration_account_id is not null and provider_position_id is not null;

create table if not exists public.ssx_tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null
    references public.integration_accounts(id) on delete cascade,
  resource_type text not null check (resource_type in (
    'evaluation_formula', 'person_role', 'trailer', 'logged_rule',
    'compatible_rule', 'unit_rule', 'rule_unit'
  )),
  scope_key text not null default '',
  external_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default clock_timestamp(),
  unique (integration_account_id, resource_type, scope_key, external_key),
  check (length(scope_key) <= 200),
  check (length(external_key) between 1 and 200)
);

create index if not exists ssx_tracking_snapshots_lookup_idx
  on public.ssx_tracking_snapshots (integration_account_id, resource_type, scope_key);

alter table public.ssx_tracking_snapshots enable row level security;
revoke all on table public.ssx_tracking_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.ssx_tracking_snapshots to service_role;

create table if not exists public.ssx_rule_violations (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null
    references public.integration_accounts(id) on delete cascade,
  provider_violation_id bigint not null check (provider_violation_id > 0),
  rule_integration_code text,
  tracked_unit_integration_code text,
  organizational_unit_integration_code text,
  driver_integration_code text,
  initial_date timestamptz,
  final_date timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  first_seen_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (integration_account_id, provider_violation_id),
  check (rule_integration_code is null or length(rule_integration_code) <= 200),
  check (tracked_unit_integration_code is null or length(tracked_unit_integration_code) <= 200),
  check (organizational_unit_integration_code is null or length(organizational_unit_integration_code) <= 200),
  check (driver_integration_code is null or length(driver_integration_code) <= 200),
  check (initial_date is null or isfinite(initial_date)),
  check (final_date is null or isfinite(final_date))
);

create index if not exists ssx_rule_violations_unit_date_idx
  on public.ssx_rule_violations (
    integration_account_id, tracked_unit_integration_code, initial_date desc
  );

alter table public.ssx_rule_violations enable row level security;
revoke all on table public.ssx_rule_violations from public, anon, authenticated;
grant select, insert, update, delete on table public.ssx_rule_violations to service_role;

create table if not exists public.ssx_rule_violation_cursors (
  integration_account_id uuid primary key
    references public.integration_accounts(id) on delete cascade,
  last_position_id bigint not null default 0 check (last_position_id >= 0),
  last_success_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  check (last_error_code is null or length(last_error_code) <= 100)
);

alter table public.ssx_rule_violation_cursors enable row level security;
revoke all on table public.ssx_rule_violation_cursors from public, anon, authenticated;
grant select, insert, update, delete on table public.ssx_rule_violation_cursors to service_role;

create or replace function public.replace_ssx_tracking_snapshot_v1(
  _integration_account_id uuid,
  _resource_type text,
  _scope_key text,
  _items jsonb,
  _received_at timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if _integration_account_id is null
     or _resource_type not in (
       'evaluation_formula', 'person_role', 'trailer', 'logged_rule',
       'compatible_rule', 'unit_rule', 'rule_unit'
     )
     or _scope_key is null or length(_scope_key) > 200
     or _items is null or jsonb_typeof(_items) <> 'array'
     or jsonb_array_length(_items) > 10000
     or octet_length(_items::text) > 8388608
     or _received_at is null or not isfinite(_received_at)
     or _received_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'ssx_snapshot_invalid';
  end if;

  perform 1 from public.integration_accounts
  where id = _integration_account_id and lower(provider) = 'ssx';
  if not found then
    raise exception using errcode = '42501', message = 'ssx_account_invalid';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_items) item
    where jsonb_typeof(item) <> 'object'
       or (item - array['external_key', 'payload']) <> '{}'::jsonb
       or jsonb_typeof(item->'external_key') <> 'string'
       or length(item->>'external_key') not between 1 and 200
       or jsonb_typeof(item->'payload') <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'ssx_snapshot_item_invalid';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_items) item
    group by item->>'external_key' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'ssx_snapshot_item_duplicate';
  end if;

  delete from public.ssx_tracking_snapshots
  where integration_account_id = _integration_account_id
    and resource_type = _resource_type and scope_key = _scope_key;

  insert into public.ssx_tracking_snapshots (
    integration_account_id, resource_type, scope_key, external_key, payload, received_at
  )
  select _integration_account_id, _resource_type, _scope_key,
         item->>'external_key', item->'payload', _received_at
  from jsonb_array_elements(_items) item;

  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.replace_ssx_tracking_snapshot_v1(uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_ssx_tracking_snapshot_v1(uuid, text, text, jsonb, timestamptz)
  to service_role;

create or replace function public.upsert_ssx_rule_violations_v1(
  _integration_account_id uuid,
  _items jsonb,
  _observed_at timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if _integration_account_id is null
     or _items is null or jsonb_typeof(_items) <> 'array'
     or jsonb_array_length(_items) > 5000
     or octet_length(_items::text) > 8388608
     or _observed_at is null or not isfinite(_observed_at)
     or _observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'ssx_violation_batch_invalid';
  end if;

  perform 1 from public.integration_accounts
  where id = _integration_account_id and lower(provider) = 'ssx';
  if not found then
    raise exception using errcode = '42501', message = 'ssx_account_invalid';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_items) item
    where jsonb_typeof(item) <> 'object'
       or (item - array[
         'provider_violation_id', 'rule_integration_code',
         'tracked_unit_integration_code', 'organizational_unit_integration_code',
         'driver_integration_code', 'initial_date', 'final_date', 'payload'
       ]) <> '{}'::jsonb
       or jsonb_typeof(item->'provider_violation_id') <> 'number'
       or (item->>'provider_violation_id')::numeric <= 0
       or jsonb_typeof(item->'payload') <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'ssx_violation_item_invalid';
  end if;

  insert into public.ssx_rule_violations (
    integration_account_id, provider_violation_id, rule_integration_code,
    tracked_unit_integration_code, organizational_unit_integration_code,
    driver_integration_code, initial_date, final_date, payload,
    first_seen_at, updated_at
  )
  select _integration_account_id, provider_violation_id, rule_integration_code,
         tracked_unit_integration_code, organizational_unit_integration_code,
         driver_integration_code, initial_date, final_date, payload,
         _observed_at, _observed_at
  from jsonb_to_recordset(_items) as item(
    provider_violation_id bigint,
    rule_integration_code text,
    tracked_unit_integration_code text,
    organizational_unit_integration_code text,
    driver_integration_code text,
    initial_date timestamptz,
    final_date timestamptz,
    payload jsonb
  )
  on conflict (integration_account_id, provider_violation_id) do update set
    rule_integration_code = excluded.rule_integration_code,
    tracked_unit_integration_code = excluded.tracked_unit_integration_code,
    organizational_unit_integration_code = excluded.organizational_unit_integration_code,
    driver_integration_code = excluded.driver_integration_code,
    initial_date = excluded.initial_date,
    final_date = excluded.final_date,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

revoke all on function public.upsert_ssx_rule_violations_v1(uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_ssx_rule_violations_v1(uuid, jsonb, timestamptz)
  to service_role;

create or replace function public.get_ssx_rule_violation_window_v1(
  _integration_account_id uuid,
  _overlap bigint default 1000,
  _window_size bigint default 50000000
)
returns table (
  expected_last_position_id text,
  start_position_id text,
  end_position_id text,
  should_poll boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_last bigint;
  v_max bigint;
  v_start bigint;
  v_end bigint;
begin
  if _integration_account_id is null
     or _overlap < 0 or _overlap > 100000
     or _window_size < 1 or _window_size > 1000000000 then
    raise exception using errcode = '22023', message = 'ssx_violation_window_invalid';
  end if;

  perform 1 from public.integration_accounts
  where id = _integration_account_id and lower(provider) = 'ssx';
  if not found then
    raise exception using errcode = '42501', message = 'ssx_account_invalid';
  end if;

  insert into public.ssx_rule_violation_cursors (integration_account_id)
  values (_integration_account_id)
  on conflict (integration_account_id) do nothing;

  select last_position_id into v_last
  from public.ssx_rule_violation_cursors
  where integration_account_id = _integration_account_id
  for update;

  select max(provider_position_id) into v_max
  from public.positions_raw
  where integration_account_id = _integration_account_id
    and provider_position_id is not null;

  if v_max is null then
    return query select v_last::text, '0'::text, '0'::text, false;
    return;
  end if;

  if v_last = 0 then
    v_start := 1;
    v_end := least(v_max, _window_size);
  elsif v_max <= v_last then
    v_start := greatest(1, v_max - _overlap + 1);
    v_end := v_max;
  else
    v_start := greatest(1, v_last - _overlap + 1);
    v_end := least(v_max, v_last + _window_size);
  end if;

  return query select v_last::text, v_start::text, v_end::text, true;
end
$function$;

revoke all on function public.get_ssx_rule_violation_window_v1(uuid, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.get_ssx_rule_violation_window_v1(uuid, bigint, bigint)
  to service_role;

create or replace function public.ack_ssx_rule_violation_window_v1(
  _integration_account_id uuid,
  _expected_last_position_id bigint,
  _end_position_id bigint,
  _success boolean,
  _error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_current bigint;
begin
  if _integration_account_id is null or _expected_last_position_id < 0
     or _end_position_id < 0 or _success is null
     or (_error_code is not null and length(_error_code) > 100) then
    raise exception using errcode = '22023', message = 'ssx_violation_ack_invalid';
  end if;

  select last_position_id into v_current
  from public.ssx_rule_violation_cursors
  where integration_account_id = _integration_account_id
  for update;
  if not found or v_current <> _expected_last_position_id then
    return false;
  end if;

  update public.ssx_rule_violation_cursors
  set last_position_id = case when _success then greatest(v_current, _end_position_id) else v_current end,
      last_success_at = case when _success then clock_timestamp() else last_success_at end,
      last_error_code = case when _success then null else coalesce(_error_code, 'unknown') end,
      updated_at = clock_timestamp()
  where integration_account_id = _integration_account_id;
  return true;
end
$function$;

revoke all on function public.ack_ssx_rule_violation_window_v1(uuid, bigint, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ack_ssx_rule_violation_window_v1(uuid, bigint, bigint, boolean, text)
  to service_role;
