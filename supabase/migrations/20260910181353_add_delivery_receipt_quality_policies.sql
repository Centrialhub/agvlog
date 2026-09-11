-- Versioned scan-quality policies. A policy is append-only: saving a change
-- retires the active version and creates the next one. Resolution is always
-- client -> tenant -> immutable application baseline.

create table public.delivery_receipt_quality_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  version integer not null check (version > 0),
  thresholds jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  retired_at timestamptz,
  retired_by uuid,
  constraint delivery_receipt_quality_policy_thresholds_check check (
    jsonb_typeof(thresholds) = 'object'
    and thresholds ?& array[
      'min_source_pixels','min_processed_short_side','min_brightness_reject',
      'min_brightness_warn','max_brightness_reject','max_glare_warn',
      'min_contrast_reject','min_contrast_warn','min_sharpness_reject',
      'min_sharpness_warn','edge_cut_action'
    ]
    and jsonb_typeof(thresholds->'min_source_pixels') = 'number'
    and jsonb_typeof(thresholds->'min_processed_short_side') = 'number'
    and jsonb_typeof(thresholds->'min_brightness_reject') = 'number'
    and jsonb_typeof(thresholds->'min_brightness_warn') = 'number'
    and jsonb_typeof(thresholds->'max_brightness_reject') = 'number'
    and jsonb_typeof(thresholds->'max_glare_warn') = 'number'
    and jsonb_typeof(thresholds->'min_contrast_reject') = 'number'
    and jsonb_typeof(thresholds->'min_contrast_warn') = 'number'
    and jsonb_typeof(thresholds->'min_sharpness_reject') = 'number'
    and jsonb_typeof(thresholds->'min_sharpness_warn') = 'number'
    and (thresholds->>'edge_cut_action') in ('warn','reject')
    and (thresholds->>'min_source_pixels')::numeric between 250000 and 50000000
    and (thresholds->>'min_processed_short_side')::numeric between 300 and 5000
    and (thresholds->>'min_brightness_reject')::numeric between 0 and 254
    and (thresholds->>'min_brightness_warn')::numeric between 0 and 254
    and (thresholds->>'max_brightness_reject')::numeric between 1 and 255
    and (thresholds->>'max_glare_warn')::numeric between 0 and 1
    and (thresholds->>'min_contrast_reject')::numeric between 0 and 255
    and (thresholds->>'min_contrast_warn')::numeric between 0 and 255
    and (thresholds->>'min_sharpness_reject')::numeric between 0 and 100
    and (thresholds->>'min_sharpness_warn')::numeric between 0 and 100
    and (thresholds->>'min_brightness_reject')::numeric
      <= (thresholds->>'min_brightness_warn')::numeric
    and (thresholds->>'min_brightness_warn')::numeric
      < (thresholds->>'max_brightness_reject')::numeric
    and (thresholds->>'min_contrast_reject')::numeric
      <= (thresholds->>'min_contrast_warn')::numeric
    and (thresholds->>'min_sharpness_reject')::numeric
      <= (thresholds->>'min_sharpness_warn')::numeric
  ),
  constraint delivery_receipt_quality_policy_retirement_check check (
    (is_active and retired_at is null and retired_by is null)
    or (not is_active and retired_at is not null and retired_by is not null)
  )
);

create unique index delivery_receipt_quality_policy_tenant_version_idx
  on public.delivery_receipt_quality_policies (tenant_id, version)
  where client_id is null;
create unique index delivery_receipt_quality_policy_client_version_idx
  on public.delivery_receipt_quality_policies (tenant_id, client_id, version)
  where client_id is not null;
create unique index delivery_receipt_quality_policy_active_tenant_idx
  on public.delivery_receipt_quality_policies (tenant_id)
  where client_id is null and is_active;
create unique index delivery_receipt_quality_policy_active_client_idx
  on public.delivery_receipt_quality_policies (tenant_id, client_id)
  where client_id is not null and is_active;
create index delivery_receipt_quality_policy_tenant_client_idx
  on public.delivery_receipt_quality_policies (tenant_id, client_id, created_at desc);

alter table public.delivery_receipt_quality_policies enable row level security;
revoke all on table public.delivery_receipt_quality_policies
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.delivery_receipt_quality_policies
  to service_role;

create or replace function public.delivery_receipt_baseline_quality_policy_v1()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'min_source_pixels', 2000000,
    'min_processed_short_side', 900,
    'min_brightness_reject', 38,
    'min_brightness_warn', 58,
    'max_brightness_reject', 248,
    'max_glare_warn', 0.08,
    'min_contrast_reject', 8,
    'min_contrast_warn', 16,
    'min_sharpness_reject', 2,
    'min_sharpness_warn', 3.5,
    'edge_cut_action', 'warn'
  );
$function$;

revoke all on function public.delivery_receipt_baseline_quality_policy_v1()
  from public, anon, authenticated, service_role;

create or replace function public.list_delivery_receipt_quality_policies_v1(
  _tenant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_rows jsonb;
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_quality_policy_not_authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', policy.id,
    'tenant_id', policy.tenant_id,
    'client_id', policy.client_id,
    'client_name', client.company_name,
    'scope', case when policy.client_id is null then 'tenant' else 'client' end,
    'version', policy.version,
    'thresholds', policy.thresholds,
    'is_active', policy.is_active,
    'created_at', policy.created_at,
    'created_by', policy.created_by,
    'retired_at', policy.retired_at
  ) order by policy.is_active desc, client.company_name nulls first,
    policy.version desc), '[]'::jsonb)
  into v_rows
  from public.delivery_receipt_quality_policies as policy
  left join public.clients as client
    on client.id = policy.client_id and client.tenant_id = policy.tenant_id
  where policy.tenant_id = _tenant_id;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', auth.uid(),
    'baseline', public.delivery_receipt_baseline_quality_policy_v1(),
    'rows', v_rows
  );
end;
$function$;

revoke all on function public.list_delivery_receipt_quality_policies_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_delivery_receipt_quality_policies_v1(uuid)
  to authenticated;

create or replace function public.save_delivery_receipt_quality_policy_v1(
  _tenant_id uuid,
  _client_id uuid,
  _thresholds jsonb,
  _expected_active_policy_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_active public.delivery_receipt_quality_policies%rowtype;
  v_saved public.delivery_receipt_quality_policies%rowtype;
  v_version integer;
begin
  if v_actor is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_quality_policy_not_authorized' using errcode = '42501';
  end if;
  if _thresholds is null or jsonb_typeof(_thresholds) <> 'object' then
    raise exception 'invalid_delivery_receipt_quality_thresholds' using errcode = '22023';
  end if;
  if _client_id is not null and not exists (
    select 1 from public.clients
    where id = _client_id and tenant_id = _tenant_id
  ) then
    raise exception 'delivery_receipt_quality_client_not_found' using errcode = 'P0002';
  end if;

  select * into v_active
  from public.delivery_receipt_quality_policies
  where tenant_id = _tenant_id
    and client_id is not distinct from _client_id
    and is_active
  for update;

  if v_active.id is distinct from _expected_active_policy_id then
    raise exception 'delivery_receipt_quality_policy_changed' using errcode = '40001';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.delivery_receipt_quality_policies
  where tenant_id = _tenant_id
    and client_id is not distinct from _client_id;

  if v_active.id is not null then
    update public.delivery_receipt_quality_policies
    set is_active = false, retired_at = clock_timestamp(), retired_by = v_actor
    where id = v_active.id;
  end if;

  begin
    insert into public.delivery_receipt_quality_policies (
      tenant_id, client_id, version, thresholds, created_by
    ) values (
      _tenant_id, _client_id, v_version, _thresholds, v_actor
    ) returning * into v_saved;
  exception when check_violation then
    raise exception 'invalid_delivery_receipt_quality_thresholds' using errcode = '22023';
  end;

  perform public._log_entity_audit(
    _tenant_id, 'delivery_receipt_quality_policy', v_saved.id, 'version_created',
    case when v_active.id is null then null else to_jsonb(v_active) end,
    to_jsonb(v_saved), 'save_delivery_receipt_quality_policy_v1'
  );

  return jsonb_build_object(
    'id', v_saved.id,
    'client_id', v_saved.client_id,
    'scope', case when v_saved.client_id is null then 'tenant' else 'client' end,
    'version', v_saved.version,
    'thresholds', v_saved.thresholds,
    'updated_at', v_saved.created_at,
    'confirmed', true
  );
end;
$function$;

revoke all on function public.save_delivery_receipt_quality_policy_v1(uuid,uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_delivery_receipt_quality_policy_v1(uuid,uuid,jsonb,uuid)
  to authenticated;

create or replace function public.retire_delivery_receipt_quality_policy_v1(
  _tenant_id uuid,
  _client_id uuid,
  _expected_active_policy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_active public.delivery_receipt_quality_policies%rowtype;
begin
  if v_actor is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_quality_policy_not_authorized' using errcode = '42501';
  end if;
  select * into v_active
  from public.delivery_receipt_quality_policies
  where id = _expected_active_policy_id
    and tenant_id = _tenant_id
    and client_id is not distinct from _client_id
    and is_active
  for update;
  if not found then
    raise exception 'delivery_receipt_quality_policy_changed' using errcode = '40001';
  end if;

  update public.delivery_receipt_quality_policies
  set is_active = false, retired_at = clock_timestamp(), retired_by = v_actor
  where id = v_active.id;
  perform public._log_entity_audit(
    _tenant_id, 'delivery_receipt_quality_policy', v_active.id, 'retired',
    to_jsonb(v_active), null, 'retire_delivery_receipt_quality_policy_v1'
  );
  return jsonb_build_object('id', v_active.id, 'retired', true, 'confirmed', true);
end;
$function$;

revoke all on function public.retire_delivery_receipt_quality_policy_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retire_delivery_receipt_quality_policy_v1(uuid,uuid,uuid)
  to authenticated;

create or replace function public.resolve_delivery_receipt_quality_policy_v1(
  _stop_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_stop record;
  v_policy public.delivery_receipt_quality_policies%rowtype;
begin
  if auth.uid() is null then
    raise exception 'delivery_receipt_quality_policy_not_authorized' using errcode = '42501';
  end if;
  select stop.tenant_id, stop.client_id, trip.driver_id
  into v_stop
  from public.dispatch_stops as stop
  join public.dispatch_trips as trip
    on trip.id = stop.dispatch_trip_id and trip.tenant_id = stop.tenant_id
  where stop.id = _stop_id;
  if not found then
    raise exception 'delivery_receipt_quality_stop_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_tenant_operator_or_admin(v_stop.tenant_id), false)
    and not exists (
      select 1 from public.drivers as driver
      where driver.id = v_stop.driver_id
        and driver.tenant_id = v_stop.tenant_id
        and driver.user_id = auth.uid()
        and driver.active
    ) then
    raise exception 'delivery_receipt_quality_policy_not_authorized' using errcode = '42501';
  end if;

  select * into v_policy
  from public.delivery_receipt_quality_policies as policy
  where policy.tenant_id = v_stop.tenant_id
    and policy.is_active
    and (policy.client_id = v_stop.client_id or policy.client_id is null)
  order by (policy.client_id is not null) desc, policy.version desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'source', 'baseline', 'policy_id', null, 'version', 1,
      'tenant_id', v_stop.tenant_id, 'client_id', v_stop.client_id,
      'thresholds', public.delivery_receipt_baseline_quality_policy_v1(),
      'resolved_at', statement_timestamp()
    );
  end if;
  return jsonb_build_object(
    'source', case when v_policy.client_id is null then 'tenant' else 'client' end,
    'policy_id', v_policy.id, 'version', v_policy.version,
    'tenant_id', v_policy.tenant_id, 'client_id', v_stop.client_id,
    'thresholds', v_policy.thresholds, 'resolved_at', statement_timestamp()
  );
end;
$function$;

revoke all on function public.resolve_delivery_receipt_quality_policy_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_delivery_receipt_quality_policy_v1(uuid)
  to authenticated;

-- Normalize and validate the immutable snapshot before proof ingestion. Old
-- offline drafts without a snapshot remain valid and receive baseline v1.
create or replace function public._normalize_delivery_receipt_quality_policy_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_client_id uuid;
  v_requested jsonb;
  v_snapshot jsonb;
  v_policy public.delivery_receipt_quality_policies%rowtype;
begin
  if jsonb_typeof(new.metadata) <> 'object'
    or nullif(new.metadata->>'receipt_processed_path', '') is null then
    return new;
  end if;
  select stop.client_id into v_client_id
  from public.dispatch_stops as stop
  where stop.id = new.dispatch_stop_id and stop.tenant_id = new.tenant_id;
  v_requested := new.metadata->'receipt_quality_policy';

  if jsonb_typeof(v_requested) = 'object'
    and coalesce(v_requested->>'source', '') in ('client','tenant')
    and coalesce(v_requested->>'policy_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_policy
    from public.delivery_receipt_quality_policies as policy
    where policy.id = (v_requested->>'policy_id')::uuid
      and policy.tenant_id = new.tenant_id
      and policy.version = (v_requested->>'version')::integer
      and policy.thresholds = v_requested->'thresholds'
      and (
        (v_requested->>'source' = 'client' and policy.client_id = v_client_id)
        or (v_requested->>'source' = 'tenant' and policy.client_id is null)
      );
    if not found then
      raise exception 'invalid_delivery_receipt_quality_policy_snapshot' using errcode = '22023';
    end if;
    v_snapshot := jsonb_build_object(
      'source', v_requested->>'source', 'policy_id', v_policy.id,
      'version', v_policy.version, 'tenant_id', new.tenant_id,
      'client_id', v_client_id, 'thresholds', v_policy.thresholds,
      'resolved_at', coalesce(v_requested->>'resolved_at', clock_timestamp()::text)
    );
  else
    v_snapshot := jsonb_build_object(
      'source', 'baseline', 'policy_id', null, 'version', 1,
      'tenant_id', new.tenant_id, 'client_id', v_client_id,
      'thresholds', public.delivery_receipt_baseline_quality_policy_v1(),
      'resolved_at', coalesce(v_requested->>'resolved_at', clock_timestamp()::text)
    );
  end if;
  new.metadata := jsonb_set(new.metadata, '{receipt_quality_policy}', v_snapshot, true);
  return new;
exception when invalid_text_representation then
  raise exception 'invalid_delivery_receipt_quality_policy_snapshot' using errcode = '22023';
end;
$function$;

revoke all on function public._normalize_delivery_receipt_quality_policy_metadata_v1()
  from public, anon, authenticated, service_role;

create trigger normalize_delivery_receipt_quality_policy_metadata_v1
before insert or update of metadata on public.proof_of_delivery
for each row execute function public._normalize_delivery_receipt_quality_policy_metadata_v1();

alter table public.delivery_receipts
  add column quality_policy_id uuid references public.delivery_receipt_quality_policies(id) on delete restrict,
  add column quality_policy_scope text check (quality_policy_scope in ('baseline','tenant','client')),
  add column quality_policy_version integer check (quality_policy_version > 0),
  add column quality_policy_snapshot jsonb,
  add constraint delivery_receipts_quality_policy_snapshot_check check (
    (quality_policy_scope is null and quality_policy_version is null
      and quality_policy_snapshot is null and quality_policy_id is null)
    or (
      quality_policy_scope is not null and quality_policy_version is not null
      and jsonb_typeof(quality_policy_snapshot) = 'object'
      and (
        (quality_policy_scope = 'baseline' and quality_policy_id is null)
        or (quality_policy_scope in ('tenant','client') and quality_policy_id is not null)
      )
    )
  );

create or replace function public._sync_delivery_receipt_from_proof_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_event_id uuid;
  v_policy jsonb;
begin
  v_receipt_id := public._sync_delivery_receipt_from_proof(new.id);
  if v_receipt_id is null or jsonb_typeof(new.metadata) <> 'object' then return new; end if;
  v_event_id := case when coalesce(new.metadata->>'event_id','') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (new.metadata->>'event_id')::uuid else null end;
  if v_event_id is null then return new; end if;
  v_policy := new.metadata->'receipt_quality_policy';

  update public.delivery_receipts set
    thumbnail_path = coalesce(thumbnail_path, nullif(new.metadata->>'receipt_thumbnail_path','')),
    original_hash = coalesce(original_hash, case when coalesce(new.metadata->>'receipt_original_hash','') ~ '^[a-f0-9]{64}$'
      then new.metadata->>'receipt_original_hash' end),
    processed_hash = coalesce(processed_hash, case when coalesce(new.metadata->>'receipt_processed_hash','') ~ '^[a-f0-9]{64}$'
      then new.metadata->>'receipt_processed_hash' end),
    thumbnail_hash = coalesce(thumbnail_hash, case when coalesce(new.metadata->>'receipt_thumbnail_hash','') ~ '^[a-f0-9]{64}$'
      then new.metadata->>'receipt_thumbnail_hash' end),
    scan_corners = coalesce(scan_corners, case when jsonb_typeof(new.metadata->'receipt_corners') = 'object'
      then new.metadata->'receipt_corners' end),
    scan_rotation = case when coalesce(new.metadata->>'receipt_rotation','') ~ '^(0|90|180|270)$'
      then (new.metadata->>'receipt_rotation')::smallint else scan_rotation end,
    quality_confirmed = quality_confirmed or lower(coalesce(new.metadata->>'receipt_quality_confirmed','false')) = 'true',
    quality_policy_id = coalesce(quality_policy_id, case
      when coalesce(v_policy->>'policy_id','') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (v_policy->>'policy_id')::uuid end),
    quality_policy_scope = coalesce(quality_policy_scope, v_policy->>'source'),
    quality_policy_version = coalesce(quality_policy_version, (v_policy->>'version')::integer),
    quality_policy_snapshot = coalesce(quality_policy_snapshot, v_policy),
    updated_at = clock_timestamp()
  where id = v_receipt_id and tenant_id = new.tenant_id and delivery_event_id = v_event_id;
  return new;
end;
$function$;

revoke all on function public._sync_delivery_receipt_from_proof_trigger()
  from public, anon, authenticated, service_role;
grant execute on function public._sync_delivery_receipt_from_proof_trigger()
  to service_role;

comment on table public.delivery_receipt_quality_policies is
  'Append-only tenant/client scan quality rules. Active resolution is client, then tenant, then baseline v1.';
comment on column public.delivery_receipts.quality_policy_snapshot is
  'Immutable snapshot of the effective quality policy used by the driver scanner, preserved for offline audit.';
