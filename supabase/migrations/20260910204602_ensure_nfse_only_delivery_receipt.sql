create or replace function delivery_private.ensure_nfse_only_delivery_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
  v_stop public.dispatch_stops%rowtype;
  v_details jsonb;
  v_policy jsonb;
  v_policy_row public.delivery_receipt_quality_policies%rowtype;
  v_policy_id uuid;
  v_policy_scope text;
  v_policy_version integer;
  v_receipt_id uuid;
begin
  if new.event_type not in ('delivery_delivered', 'stop_partial_delivery')
    or coalesce(new.payload->>'source', '') <> 'driver_app' then
    return new;
  end if;

  select * into v_stop
  from public.dispatch_stops
  where id = new.dispatch_stop_id and tenant_id = new.tenant_id;
  select * into v_trip
  from public.dispatch_trips
  where id = new.dispatch_trip_id and tenant_id = new.tenant_id;
  if v_stop.id is null or v_trip.id is null then return new; end if;

  -- NF-e/CT-e allocations continue through proof_of_delivery. This bridge is
  -- exclusively for a stop whose fiscal peers are NFS-e records.
  if exists (
    select 1 from public.dispatch_stop_documents as allocation
    where allocation.tenant_id = new.tenant_id
      and allocation.dispatch_stop_id = new.dispatch_stop_id
  ) or not exists (
    select 1
    from public.nfse_documents as nfse
    where nfse.tenant_id = new.tenant_id
      and nfse.status in ('issued', 'authorized')
      and (
        exists (
          select 1 from public.dispatch_stop_nfse_documents as direct_link
          where direct_link.tenant_id = new.tenant_id
            and direct_link.dispatch_stop_id = new.dispatch_stop_id
            and direct_link.nfse_document_id = nfse.id
        )
        or (
          nfse.trip_id = new.dispatch_trip_id
          and 1 = (
            select count(*) from public.dispatch_stops as trip_stop
            where trip_stop.tenant_id = new.tenant_id
              and trip_stop.dispatch_trip_id = new.dispatch_trip_id
          )
        )
        or (
          nfse.load_id is not null
          and nfse.load_id in (
            select trip_load.load_id from public.dispatch_trip_loads as trip_load
            where trip_load.tenant_id = new.tenant_id
              and trip_load.dispatch_trip_id = new.dispatch_trip_id
          )
          and 1 = (
            select count(distinct trip_stop.id)
            from public.dispatch_stops as trip_stop
            where trip_stop.tenant_id = new.tenant_id
              and trip_stop.dispatch_trip_id = new.dispatch_trip_id
          )
        )
      )
  ) then
    return new;
  end if;

  v_details := new.payload->'delivery_request'->'details';
  if jsonb_typeof(v_details) <> 'object' then v_details := new.payload; end if;
  v_policy := v_details->'receipt_quality_policy';

  if jsonb_typeof(v_policy) = 'object'
    and coalesce(v_policy->>'source', '') in ('tenant', 'client')
    and coalesce(v_policy->>'policy_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(v_policy->>'version', '') ~ '^[1-9][0-9]*$' then
    select * into v_policy_row
      from public.delivery_receipt_quality_policies as policy
      where policy.id = (v_policy->>'policy_id')::uuid
        and policy.tenant_id = new.tenant_id
        and policy.version = (v_policy->>'version')::integer
        and policy.thresholds = v_policy->'thresholds'
        and (
          (v_policy->>'source' = 'client' and policy.client_id = v_stop.client_id)
          or (v_policy->>'source' = 'tenant' and policy.client_id is null)
        );
    if not found then
      raise exception 'invalid_delivery_receipt_quality_policy_snapshot' using errcode = '22023';
    end if;
    v_policy_id := v_policy_row.id;
    v_policy_scope := v_policy->>'source';
    v_policy_version := v_policy_row.version;
    v_policy := jsonb_build_object(
      'source', v_policy_scope, 'policy_id', v_policy_row.id,
      'version', v_policy_row.version, 'tenant_id', new.tenant_id,
      'client_id', v_stop.client_id, 'thresholds', v_policy_row.thresholds,
      'resolved_at', coalesce(v_policy->>'resolved_at', clock_timestamp()::text)
    );
  else
    v_policy := jsonb_build_object(
      'source', 'baseline', 'policy_id', null, 'version', 1,
      'tenant_id', new.tenant_id, 'client_id', v_stop.client_id,
      'thresholds', public.delivery_receipt_baseline_quality_policy_v1(),
      'resolved_at', coalesce(v_policy->>'resolved_at', clock_timestamp()::text)
    );
    v_policy_scope := 'baseline';
    v_policy_version := 1;
  end if;

  insert into public.delivery_receipts (
    tenant_id, delivery_event_id, dispatch_trip_id, dispatch_stop_id,
    driver_id, vehicle_id, digital_status, physical_status,
    original_path, processed_path, thumbnail_path, signature_path,
    original_hash, processed_hash, thumbnail_hash,
    scan_mode, scan_quality, scan_corners, scan_rotation, quality_confirmed,
    quality_policy_id, quality_policy_scope, quality_policy_version, quality_policy_snapshot,
    receiver_name, receiver_document, receiver_role, captured_at, delivered_at,
    latitude, longitude, accuracy_m, created_by
  ) values (
    new.tenant_id, new.id, new.dispatch_trip_id, new.dispatch_stop_id,
    v_trip.driver_id, v_trip.vehicle_id, 'uploaded', 'pending_return',
    nullif(v_details->>'receipt_original_path', ''),
    nullif(v_details->>'receipt_processed_path', ''),
    nullif(v_details->>'receipt_thumbnail_path', ''),
    nullif(v_details->>'signature_path', ''),
    nullif(v_details->>'receipt_original_hash', ''),
    nullif(v_details->>'receipt_processed_hash', ''),
    nullif(v_details->>'receipt_thumbnail_hash', ''),
    v_details->>'receipt_scan_mode',
    coalesce(v_details->'receipt_scan_quality', '{}'::jsonb),
    case when jsonb_typeof(v_details->'receipt_corners') = 'object'
      then v_details->'receipt_corners' end,
    coalesce((v_details->>'receipt_rotation')::smallint, 0),
    coalesce((v_details->>'receipt_quality_confirmed')::boolean, false),
    v_policy_id, v_policy_scope, v_policy_version, v_policy,
    nullif(v_details->>'receiver_name', ''),
    nullif(v_details->>'receiver_document', ''),
    nullif(v_details->>'receiver_role', ''),
    coalesce((v_details->>'captured_at')::timestamptz, new.event_at), new.event_at,
    (v_details->>'latitude')::numeric,
    (v_details->>'longitude')::numeric,
    (v_details->>'accuracy_m')::numeric,
    new.created_by
  )
  on conflict (tenant_id, delivery_event_id, version) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is not null then
    perform delivery_private.sync_delivery_receipt_nfse_peers_v1(v_receipt_id);
  end if;
  return new;
end;
$function$;

revoke all on function delivery_private.ensure_nfse_only_delivery_receipt_v1()
  from public, anon, authenticated, service_role;

create trigger ensure_nfse_only_delivery_receipt_v1
after insert on public.dispatch_events
for each row execute function delivery_private.ensure_nfse_only_delivery_receipt_v1();

comment on function delivery_private.ensure_nfse_only_delivery_receipt_v1() is
  'Materializes the one canonical canhoto for a real driver delivery backed only by NFS-e peers; NF-e and CT-e remain optional peer links.';
