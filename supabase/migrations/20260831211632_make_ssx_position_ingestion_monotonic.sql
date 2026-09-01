-- Persist one provider-unit batch as one transaction. The public function is
-- an RPC transport for the service role only; it remains SECURITY INVOKER so
-- it does not add another privileged API surface.

create schema if not exists ssx_private;
revoke all on schema ssx_private from public, anon, authenticated;

do $block$
begin
  if exists (
    select 1 from public.vehicle_tracker_links
    where active
    group by tenant_id, provider_unit_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'ssx_active_unit_binding_duplicates';
  end if;
  if exists (
    select 1 from public.vehicle_tracker_links
    where active
    group by tenant_id, vehicle_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'ssx_active_vehicle_binding_duplicates';
  end if;
end;
$block$;

create unique index if not exists uq_ssx_active_link_per_unit
  on public.vehicle_tracker_links (tenant_id, provider_unit_id)
  where active;
create unique index if not exists uq_ssx_active_link_per_vehicle
  on public.vehicle_tracker_links (tenant_id, vehicle_id)
  where active;

create or replace function public.assert_tenant_integration_capability_v1(
  _tenant_id uuid,
  _capability text
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_enabled boolean := false;
  v_kill_switch boolean := true;
  v_policy_rows integer := 0;
begin
  if _capability not in ('ssx', 'fiscal') then
    raise exception using errcode = '22023', message = 'unknown_integration_capability';
  end if;

  select
    coalesce(bool_or(policy.enabled) filter (
      where policy.feature_key = _capability || '_enabled'
    ), false),
    coalesce(bool_or(policy.enabled) filter (
      where policy.feature_key = _capability || '_kill_switch'
    ), true),
    count(*)::integer
  into v_enabled, v_kill_switch, v_policy_rows
  from public.tenant_feature_policy policy
  where policy.tenant_id = _tenant_id
    and policy.feature_key in (_capability || '_enabled', _capability || '_kill_switch');

  if v_policy_rows <> 2 or not v_enabled or v_kill_switch then
    raise exception using
      errcode = '42501',
      message = 'integration_capability_disabled',
      detail = _capability;
  end if;
end;
$function$;

revoke all on function public.assert_tenant_integration_capability_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.assert_tenant_integration_capability_v1(uuid, text)
  to service_role;

comment on function public.assert_tenant_integration_capability_v1(uuid, text)
  is 'Fail-closed service-only integration guard. Both enabled and kill-switch policy rows must exist.';

alter table public.positions_raw
  add column if not exists integration_account_id uuid,
  add column if not exists provider_unit_id uuid,
  add column if not exists tracker_link_id uuid;

alter table public.integration_accounts
  add column if not exists poll_cooldown_until timestamptz;

create index if not exists idx_positions_raw_ssx_binding_captured_at
  on public.positions_raw (
    tenant_id, vehicle_id, tracker_link_id,
    integration_account_id, provider_unit_id, captured_at desc
  )
  where tracker_link_id is not null;

create or replace function ssx_private.distance_m(
  _lat1 double precision, _lng1 double precision,
  _lat2 double precision, _lng2 double precision
)
returns double precision
language sql immutable strict security invoker
set search_path = ''
as $function$
  select 6371000.0 * 2.0 * asin(
    least(1.0, sqrt(
      power(sin(radians(_lat2 - _lat1) / 2.0), 2) +
      cos(radians(_lat1)) * cos(radians(_lat2)) *
      power(sin(radians(_lng2 - _lng1) / 2.0), 2)
    ))
  )
$function$;

revoke all on function ssx_private.distance_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant usage on schema ssx_private to service_role;
grant execute on function ssx_private.distance_m(double precision, double precision, double precision, double precision)
  to service_role;

create or replace function public.commit_ssx_position_batch_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _provider_unit_id uuid,
  _tracker_link_id uuid,
  _vehicle_id uuid,
  _received_at timestamptz,
  _positions jsonb,
  _poll_memo jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account public.integration_accounts%rowtype;
  v_unit public.provider_units%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_link public.vehicle_tracker_links%rowtype;
  v_current public.positions_last%rowtype;
  v_latest record;
  v_previous record;
  v_enabled boolean := false;
  v_kill_switch boolean := false;
  v_capability_rows integer := 0;
  v_attempted integer;
  v_inserted integer := 0;
  v_active_links integer := 0;
  v_distance_m double precision;
  v_seconds double precision;
  v_speed double precision;
  v_speed_source text;
  v_movement_state text;
  v_applied boolean := false;
  v_same_binding boolean := false;
  v_rows_changed integer := 0;
begin
  if _tenant_id is null or _integration_account_id is null or
     _provider_unit_id is null or _tracker_link_id is null or _vehicle_id is null then
    raise exception using errcode = '22023', message = 'ssx_batch_identity_required';
  end if;
  if _received_at is null or not isfinite(_received_at) or
     _received_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'ssx_batch_received_at_invalid';
  end if;
  if _positions is null or jsonb_typeof(_positions) <> 'array' or jsonb_array_length(_positions) > 5000 or
     octet_length(_positions::text) > 8388608 then
    raise exception using errcode = '22023', message = 'ssx_batch_invalid';
  end if;
  if _poll_memo is null or jsonb_typeof(_poll_memo) <> 'object' or
     octet_length(_poll_memo::text) > 16384 then
    raise exception using errcode = '22023', message = 'ssx_poll_memo_invalid';
  end if;

  -- Parent-first locks match FK cascades and prevent a tenant/vehicle deletion
  -- from deadlocking with ingestion. The advisory lock also serializes the
  -- first observation, when positions_last does not exist yet.
  perform 1 from public.tenants where id = _tenant_id for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_tenant_not_found';
  end if;
  select * into v_vehicle
  from public.vehicles
  where id = _vehicle_id and tenant_id = _tenant_id
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_vehicle_tenant_mismatch';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(_tenant_id::text || ':' || _vehicle_id::text, 0)
  );

  select * into v_account
  from public.integration_accounts
  where id = _integration_account_id and tenant_id = _tenant_id
  for share;
  if not found or lower(v_account.provider) <> 'ssx' or
     v_account.status not in ('ok', 'pending', 'degraded') then
    raise exception using errcode = '42501', message = 'ssx_account_not_active';
  end if;

  select * into v_unit
  from public.provider_units
  where id = _provider_unit_id and tenant_id = _tenant_id
    and integration_account_id = _integration_account_id and active
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_unit_not_active';
  end if;

  -- Lock the exact binding supplied by the worker. A remap that deactivates
  -- this row must finish before this transaction can continue.
  select * into v_link
  from public.vehicle_tracker_links
  where id = _tracker_link_id and tenant_id = _tenant_id
    and provider_unit_id = _provider_unit_id and vehicle_id = _vehicle_id
  for share;
  if not found or not v_link.active or v_link.start_at > clock_timestamp() or
     (v_link.end_at is not null and v_link.end_at <= clock_timestamp()) then
    raise exception using errcode = '40001', message = 'ssx_tracker_binding_changed';
  end if;

  perform 1 from public.vehicle_tracker_links
  where tenant_id = _tenant_id
    and (provider_unit_id = _provider_unit_id or vehicle_id = _vehicle_id)
    and active and start_at <= clock_timestamp()
    and (end_at is null or end_at > clock_timestamp())
  order by id for share;
  select count(*) into v_active_links
  from public.vehicle_tracker_links
  where tenant_id = _tenant_id and provider_unit_id = _provider_unit_id
    and active and start_at <= clock_timestamp()
    and (end_at is null or end_at > clock_timestamp());
  if v_active_links <> 1 then
    raise exception using errcode = '23505', message = 'ssx_tracker_binding_ambiguous';
  end if;
  select count(*) into v_active_links
  from public.vehicle_tracker_links
  where tenant_id = _tenant_id and vehicle_id = _vehicle_id
    and active and start_at <= clock_timestamp()
    and (end_at is null or end_at > clock_timestamp());
  if v_active_links <> 1 then
    raise exception using errcode = '23505', message = 'ssx_vehicle_binding_ambiguous';
  end if;

  -- Keep the lock order compatible with live-trip evaluation: position first,
  -- feature flags second. The capability is rechecked before telemetry writes.
  select * into v_current
  from public.positions_last
  where tenant_id = _tenant_id and vehicle_id = _vehicle_id
  for update;

  perform 1 from public.tenant_feature_policy
  where tenant_id = _tenant_id
    and feature_key in ('ssx_enabled', 'ssx_kill_switch')
  order by feature_key for share;
  select
    coalesce(bool_or(enabled) filter (where feature_key = 'ssx_enabled'), false),
    coalesce(bool_or(enabled) filter (where feature_key = 'ssx_kill_switch'), false),
    count(*)::integer
  into v_enabled, v_kill_switch, v_capability_rows
  from public.tenant_feature_policy
  where tenant_id = _tenant_id
    and feature_key in ('ssx_enabled', 'ssx_kill_switch');
  if v_capability_rows <> 2 or not v_enabled or v_kill_switch then
    raise exception using errcode = '42501', message = 'integration_capability_disabled', detail = 'ssx';
  end if;

  v_attempted := jsonb_array_length(_positions);
  if exists (
    select 1 from jsonb_array_elements(_positions) item
    where jsonb_typeof(item) <> 'object'
       or (item - array['captured_at','lat','lng','speed','heading','telemetry','provider_payload_hash']) <> '{}'::jsonb
       or jsonb_typeof(item->'captured_at') <> 'string'
       or jsonb_typeof(item->'lat') <> 'number'
       or jsonb_typeof(item->'lng') <> 'number'
       or (item ? 'speed' and item->'speed' <> 'null'::jsonb and jsonb_typeof(item->'speed') <> 'number')
       or (item ? 'heading' and item->'heading' <> 'null'::jsonb and jsonb_typeof(item->'heading') <> 'number')
       or (item ? 'telemetry' and item->'telemetry' <> 'null'::jsonb and jsonb_typeof(item->'telemetry') <> 'object')
       or jsonb_typeof(item->'provider_payload_hash') <> 'string'
  ) then
    raise exception using errcode = '22023', message = 'ssx_position_shape_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(_positions) as p(
      captured_at timestamptz, lat double precision, lng double precision,
      speed double precision, heading double precision, telemetry jsonb,
      provider_payload_hash text
    )
    where captured_at is null or not isfinite(captured_at)
       or captured_at < timestamptz '2000-01-01 00:00:00+00'
       or captured_at > _received_at + interval '5 minutes'
       or lat is null or lat < -90 or lat > 90
       or lng is null or lng < -180 or lng > 180
       or (speed is not null and (speed < 0 or speed > 300))
       or (heading is not null and (heading < 0 or heading > 360))
       or provider_payload_hash is null or length(provider_payload_hash) < 8
       or length(provider_payload_hash) > 200
  ) then
    raise exception using errcode = '22023', message = 'ssx_position_value_invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(_positions) as p(captured_at timestamptz)
    where p.captured_at < v_link.start_at
       or (v_link.end_at is not null and p.captured_at >= v_link.end_at)
  ) then
    raise exception using errcode = '22023', message = 'ssx_position_outside_binding_window';
  end if;

  -- A provider hash is only a dedupe key. Never allow reuse/collision to make
  -- positions_last disagree with the immutable raw row.
  if exists (
    select 1
    from jsonb_array_elements(_positions) item
    group by item->>'provider_payload_hash'
    having count(distinct item) > 1
  ) then
    raise exception using errcode = '22023', message = 'ssx_position_hash_conflict';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(_positions) as p(
      captured_at timestamptz, lat double precision, lng double precision,
      speed double precision, heading double precision, telemetry jsonb,
      provider_payload_hash text
    )
    join public.positions_raw r
      on r.tenant_id = _tenant_id and r.vehicle_id = _vehicle_id
     and r.provider_payload_hash = p.provider_payload_hash
    where r.captured_at is distinct from p.captured_at
       or r.lat is distinct from p.lat
       or r.lng is distinct from p.lng
       or r.speed is distinct from p.speed
       or r.heading is distinct from p.heading
       or coalesce(r.telemetry, '{}'::jsonb) is distinct from coalesce(p.telemetry, '{}'::jsonb)
       or (r.integration_account_id is not null and r.integration_account_id <> _integration_account_id)
       or (r.provider_unit_id is not null and r.provider_unit_id <> _provider_unit_id)
       or (r.tracker_link_id is not null and r.tracker_link_id <> _tracker_link_id)
  ) then
    raise exception using errcode = '22023', message = 'ssx_position_hash_conflict';
  end if;

  select count(distinct p.provider_payload_hash)::integer into v_inserted
  from jsonb_to_recordset(_positions) as p(provider_payload_hash text)
  where not exists (
    select 1 from public.positions_raw r
    where r.tenant_id = _tenant_id and r.vehicle_id = _vehicle_id
      and r.provider_payload_hash = p.provider_payload_hash
  );

  insert into public.positions_raw (
    tenant_id, vehicle_id, captured_at, received_at, lat, lng,
    speed, heading, telemetry, provider_payload_hash,
    integration_account_id, provider_unit_id, tracker_link_id
  )
  select distinct on (p.provider_payload_hash)
         _tenant_id, _vehicle_id, p.captured_at, _received_at, p.lat, p.lng,
         p.speed, p.heading, coalesce(p.telemetry, '{}'::jsonb), p.provider_payload_hash,
         _integration_account_id, _provider_unit_id, _tracker_link_id
  from jsonb_to_recordset(_positions) as p(
    captured_at timestamptz, lat double precision, lng double precision,
    speed double precision, heading double precision, telemetry jsonb,
    provider_payload_hash text
  )
  order by p.provider_payload_hash
  on conflict (tenant_id, vehicle_id, provider_payload_hash) do update set
    integration_account_id = coalesce(public.positions_raw.integration_account_id, excluded.integration_account_id),
    provider_unit_id = coalesce(public.positions_raw.provider_unit_id, excluded.provider_unit_id),
    tracker_link_id = coalesce(public.positions_raw.tracker_link_id, excluded.tracker_link_id)
  where public.positions_raw.integration_account_id is null
     or public.positions_raw.provider_unit_id is null
     or public.positions_raw.tracker_link_id is null;

  select r.captured_at, r.lat, r.lng, r.speed, r.heading,
         coalesce(r.telemetry, '{}'::jsonb) as telemetry, r.provider_payload_hash
  into v_latest
  from public.positions_raw r
  where r.tenant_id = _tenant_id and r.vehicle_id = _vehicle_id
    and r.integration_account_id = _integration_account_id
    and r.provider_unit_id = _provider_unit_id
    and r.tracker_link_id = _tracker_link_id
    and r.provider_payload_hash in (
      select item->>'provider_payload_hash'
      from jsonb_array_elements(_positions) item
    )
  order by r.captured_at desc, r.provider_payload_hash desc
  limit 1;

  if v_latest.captured_at is not null and
     (v_current.tenant_id is null or v_latest.captured_at > v_current.captured_at) then
    v_same_binding := v_current.tenant_id is not null
      and v_current.source->>'integration_account_id' = _integration_account_id::text
      and v_current.source->>'provider_unit_id' = _provider_unit_id::text
      and v_current.source->>'tracker_link_id' = _tracker_link_id::text;
    v_distance_m := null;
    v_seconds := null;
    select r.lat, r.lng, r.captured_at into v_previous
    from public.positions_raw r
    where r.tenant_id = _tenant_id and r.vehicle_id = _vehicle_id
      and r.integration_account_id = _integration_account_id
      and r.provider_unit_id = _provider_unit_id
      and r.tracker_link_id = _tracker_link_id
      and r.captured_at < v_latest.captured_at
    order by r.captured_at desc, r.provider_payload_hash desc
    limit 1;
    if found then
      v_distance_m := ssx_private.distance_m(v_previous.lat, v_previous.lng, v_latest.lat, v_latest.lng);
      v_seconds := extract(epoch from (v_latest.captured_at - v_previous.captured_at));
    elsif v_same_binding then
      v_distance_m := ssx_private.distance_m(v_current.lat, v_current.lng, v_latest.lat, v_latest.lng);
      v_seconds := extract(epoch from (v_latest.captured_at - v_current.captured_at));
    end if;
    if v_latest.speed is not null then
      v_speed := v_latest.speed;
      v_speed_source := 'provider';
    elsif v_seconds > 0 then
      v_speed := case when v_distance_m < 5 then 0
                      else round(((v_distance_m / v_seconds) * 3.6)::numeric, 1)::double precision end;
      v_speed_source := 'computed';
      if v_speed > 300 then
        v_speed := null;
        v_speed_source := 'invalid_delta';
      end if;
    else
      v_speed := null;
      v_speed_source := 'unknown';
    end if;
    v_movement_state := case when v_speed is null then 'unknown'
                             when v_speed > 3 then 'moving' else 'stopped' end;

    insert into public.positions_last (
      tenant_id, vehicle_id, lat, lng, speed, heading, captured_at,
      received_at, telemetry_snapshot, source
    ) values (
      _tenant_id, _vehicle_id, v_latest.lat, v_latest.lng, v_speed, v_latest.heading,
      v_latest.captured_at, _received_at, v_latest.telemetry,
      jsonb_build_object(
        'provider', 'SSX',
        'integration_account_id', _integration_account_id,
        'provider_unit_id', _provider_unit_id,
        'tracker_link_id', _tracker_link_id,
        'unit_code', v_unit.external_code,
        'stale', _received_at - v_latest.captured_at > interval '30 minutes',
        'combo_source', coalesce(_poll_memo->>'combo_source', 'unknown'),
        'speed_source', v_speed_source,
        'movement_state', v_movement_state,
        'distance_from_previous_m', case when v_distance_m is null then null else round(v_distance_m)::bigint end,
        'time_since_previous_s', case when v_seconds is null then null else round(v_seconds)::bigint end
      )
    )
    on conflict (tenant_id, vehicle_id) do update set
      lat = excluded.lat, lng = excluded.lng, speed = excluded.speed,
      heading = excluded.heading, captured_at = excluded.captured_at,
      received_at = excluded.received_at,
      telemetry_snapshot = excluded.telemetry_snapshot, source = excluded.source
    where excluded.captured_at > public.positions_last.captured_at;
    get diagnostics v_rows_changed = row_count;
    v_applied := v_rows_changed > 0;

    if v_applied then
      insert into public.vehicle_processing_queue (
        tenant_id, vehicle_id, queued_at, last_position_at,
        attempts, processed_at, last_error
      ) values (
        _tenant_id, _vehicle_id, _received_at, v_latest.captured_at,
        0, null, null
      )
      on conflict (tenant_id, vehicle_id) do update set
        queued_at = greatest(public.vehicle_processing_queue.queued_at, excluded.queued_at),
        last_position_at = greatest(public.vehicle_processing_queue.last_position_at, excluded.last_position_at),
        attempts = 0, processed_at = null, last_error = null
      where public.vehicle_processing_queue.last_position_at is null
         or excluded.last_position_at > public.vehicle_processing_queue.last_position_at;
    end if;
  end if;

  insert into public.ingestion_cursors (
    tenant_id, provider_unit_id, last_polled_at, last_success_at,
    last_error_at, last_error, backoff_until, poll_memo
  ) values (
    _tenant_id, _provider_unit_id, _received_at, v_latest.captured_at,
    null, null, null, _poll_memo
  )
  on conflict (tenant_id, provider_unit_id) do update set
    last_polled_at = greatest(public.ingestion_cursors.last_polled_at, excluded.last_polled_at),
    last_success_at = case
      when excluded.last_success_at is null then public.ingestion_cursors.last_success_at
      when public.ingestion_cursors.last_success_at is null then excluded.last_success_at
      else greatest(public.ingestion_cursors.last_success_at, excluded.last_success_at)
    end,
    last_error_at = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then null else public.ingestion_cursors.last_error_at end,
    last_error = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then null else public.ingestion_cursors.last_error end,
    backoff_until = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then null else public.ingestion_cursors.backoff_until end,
    poll_memo = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then excluded.poll_memo
      else public.ingestion_cursors.poll_memo end;

  return jsonb_build_object(
    'version', 1, 'tenant_id', _tenant_id,
    'integration_account_id', _integration_account_id,
    'provider_unit_id', _provider_unit_id, 'tracker_link_id', _tracker_link_id,
    'vehicle_id', _vehicle_id, 'attempted', v_attempted,
    'inserted', v_inserted, 'duplicates', v_attempted - v_inserted,
    'latest_applied', v_applied, 'latest_captured_at', v_latest.captured_at
  );
end;
$function$;

revoke all on function public.commit_ssx_position_batch_v1(
  uuid, uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.commit_ssx_position_batch_v1(
  uuid, uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb
) to service_role;

comment on function public.commit_ssx_position_batch_v1(
  uuid, uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb
) is 'Service-only atomic SSX persistence: validates active binding and kill switch; history, monotonic latest position, cursor and queue commit together. Empty batches update polling health without inventing movement.';

create or replace function public.record_ssx_poll_error_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _provider_unit_id uuid,
  _tracker_link_id uuid,
  _vehicle_id uuid,
  _observed_at timestamptz,
  _error text,
  _backoff_until timestamptz,
  _poll_memo jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account public.integration_accounts%rowtype;
  v_unit public.provider_units%rowtype;
  v_link public.vehicle_tracker_links%rowtype;
begin
  if _tenant_id is null or _integration_account_id is null or
     _provider_unit_id is null or _tracker_link_id is null or _vehicle_id is null or
     _observed_at is null or not isfinite(_observed_at) or
     _observed_at > clock_timestamp() + interval '5 minutes' or
     nullif(btrim(_error), '') is null or length(_error) > 500 or
     (_backoff_until is not null and (
       not isfinite(_backoff_until) or _backoff_until < _observed_at or
       _backoff_until > _observed_at + interval '1 day'
     )) or _poll_memo is null or jsonb_typeof(_poll_memo) <> 'object' or
     octet_length(_poll_memo::text) > 16384 then
    raise exception using errcode = '22023', message = 'ssx_poll_error_invalid';
  end if;

  perform 1 from public.tenants where id = _tenant_id for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_tenant_not_found';
  end if;
  perform 1 from public.vehicles
  where id = _vehicle_id and tenant_id = _tenant_id
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_vehicle_tenant_mismatch';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(_tenant_id::text || ':' || _vehicle_id::text, 0)
  );
  select * into v_account from public.integration_accounts
  where id = _integration_account_id and tenant_id = _tenant_id
  for share;
  if not found or lower(v_account.provider) <> 'ssx' then
    raise exception using errcode = '42501', message = 'ssx_account_not_active';
  end if;
  select * into v_unit from public.provider_units
  where id = _provider_unit_id and tenant_id = _tenant_id
    and integration_account_id = _integration_account_id and active
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_unit_not_active';
  end if;
  select * into v_link from public.vehicle_tracker_links
  where id = _tracker_link_id and tenant_id = _tenant_id
    and provider_unit_id = _provider_unit_id and vehicle_id = _vehicle_id
  for share;
  if not found or not v_link.active or v_link.start_at > clock_timestamp() or
     (v_link.end_at is not null and v_link.end_at <= clock_timestamp()) then
    raise exception using errcode = '40001', message = 'ssx_tracker_binding_changed';
  end if;

  insert into public.ingestion_cursors(
    tenant_id, provider_unit_id, last_polled_at, last_error_at,
    last_error, backoff_until, poll_memo
  ) values (
    _tenant_id, _provider_unit_id, _observed_at, _observed_at,
    _error, _backoff_until, _poll_memo
  )
  on conflict (tenant_id, provider_unit_id) do update set
    last_polled_at = greatest(public.ingestion_cursors.last_polled_at, excluded.last_polled_at),
    last_error_at = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then excluded.last_error_at else public.ingestion_cursors.last_error_at end,
    last_error = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then excluded.last_error else public.ingestion_cursors.last_error end,
    backoff_until = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then excluded.backoff_until else public.ingestion_cursors.backoff_until end,
    poll_memo = case
      when excluded.last_polled_at >= coalesce(public.ingestion_cursors.last_polled_at, '-infinity'::timestamptz)
        then excluded.poll_memo
      else public.ingestion_cursors.poll_memo end;

  return jsonb_build_object(
    'version', 1, 'tenant_id', _tenant_id,
    'integration_account_id', _integration_account_id,
    'provider_unit_id', _provider_unit_id, 'tracker_link_id', _tracker_link_id,
    'vehicle_id', _vehicle_id, 'observed_at', _observed_at
  );
end;
$function$;

revoke all on function public.record_ssx_poll_error_v1(
  uuid, uuid, uuid, uuid, uuid, timestamptz, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.record_ssx_poll_error_v1(
  uuid, uuid, uuid, uuid, uuid, timestamptz, text, timestamptz, jsonb
) to service_role;

create or replace function public.record_ssx_account_cooldown_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _observed_at timestamptz,
  _cooldown_until timestamptz,
  _error text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing timestamptz;
  v_effective timestamptz;
  v_enabled boolean := false;
  v_kill_switch boolean := true;
  v_capability_rows integer := 0;
begin
  if _tenant_id is null or _integration_account_id is null or
     _observed_at is null or not isfinite(_observed_at) or
     _cooldown_until is null or not isfinite(_cooldown_until) or
     _cooldown_until < _observed_at or _cooldown_until > _observed_at + interval '1 hour' or
     _observed_at > clock_timestamp() + interval '5 minutes' or
     _error is null or btrim(_error) = '' or length(_error) > 500 then
    raise exception using errcode = '22023', message = 'ssx_account_cooldown_invalid';
  end if;

  perform 1 from public.tenants where id = _tenant_id for key share;
  if not found then
    raise exception using errcode = '22023', message = 'ssx_tenant_not_found';
  end if;

  select poll_cooldown_until
  into v_existing
  from public.integration_accounts
  where id = _integration_account_id and tenant_id = _tenant_id and provider = 'SSX'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'ssx_account_changed';
  end if;

  perform 1 from public.tenant_feature_policy
  where tenant_id = _tenant_id and feature_key in ('ssx_enabled', 'ssx_kill_switch')
  order by feature_key for share;
  select coalesce(bool_or(enabled) filter (where feature_key = 'ssx_enabled'), false),
         coalesce(bool_or(enabled) filter (where feature_key = 'ssx_kill_switch'), true),
         count(*)::integer
  into v_enabled, v_kill_switch, v_capability_rows
  from public.tenant_feature_policy
  where tenant_id = _tenant_id and feature_key in ('ssx_enabled', 'ssx_kill_switch');
  if v_capability_rows <> 2 or not v_enabled or v_kill_switch then
    raise exception using errcode = '42501', message = 'integration_capability_disabled', detail = 'ssx';
  end if;

  v_effective := greatest(coalesce(v_existing, '-infinity'::timestamptz), _cooldown_until);

  update public.integration_accounts
  set poll_cooldown_until = v_effective,
      last_error = _error,
      updated_at = greatest(coalesce(updated_at, '-infinity'::timestamptz), _observed_at)
  where id = _integration_account_id and tenant_id = _tenant_id;

  return jsonb_build_object(
    'version', 1, 'tenant_id', _tenant_id,
    'integration_account_id', _integration_account_id,
    'observed_at', _observed_at, 'cooldown_until', v_effective
  );
end;
$function$;

revoke all on function public.record_ssx_account_cooldown_v1(
  uuid, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_ssx_account_cooldown_v1(
  uuid, uuid, timestamptz, timestamptz, text
) to service_role;

comment on function public.record_ssx_account_cooldown_v1(
  uuid, uuid, timestamptz, timestamptz, text
) is 'Service-only monotonic SSX account cooldown update. Uses a dedicated column so concurrent configuration writers cannot erase it.';
