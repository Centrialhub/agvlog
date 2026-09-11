create schema if not exists delivery_private;
revoke all on schema delivery_private from public, anon, authenticated;

create or replace function delivery_private.validate_driver_delivery_dispatch_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_details jsonb;
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
begin
  if coalesce(new.payload->>'source','') <> 'driver_app' then return new; end if;
  v_details := new.payload->'delivery_request'->'details';
  if jsonb_typeof(v_details) <> 'object' then v_details := new.payload; end if;

  if new.event_type in ('stop_returned','stop_refused')
    and (jsonb_typeof(v_details->'photo_paths') <> 'array'
      or jsonb_array_length(v_details->'photo_paths') = 0) then
    raise exception 'driver_refusal_photo_required' using errcode = '22023';
  end if;

  if new.event_type in ('delivery_delivered','stop_partial_delivery') then
    if coalesce(jsonb_typeof(v_details->'latitude'),'null') <> 'number'
      or coalesce(jsonb_typeof(v_details->'longitude'),'null') <> 'number'
      or coalesce(jsonb_typeof(v_details->'accuracy_m'),'null') <> 'number' then
      raise exception 'driver_delivery_gps_required' using errcode = '22023';
    end if;
    v_latitude := (v_details->>'latitude')::double precision;
    v_longitude := (v_details->>'longitude')::double precision;
    v_accuracy := (v_details->>'accuracy_m')::double precision;
    if v_latitude not between -90 and 90
      or v_longitude not between -180 and 180
      or v_accuracy < 0 or v_accuracy > 150 then
      raise exception 'driver_delivery_gps_invalid' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function delivery_private.validate_driver_delivery_dispatch_evidence_v1()
  from public, anon, authenticated, service_role;

create trigger validate_driver_delivery_dispatch_evidence_v1
before insert on public.dispatch_events
for each row execute function delivery_private.validate_driver_delivery_dispatch_evidence_v1();

create or replace function delivery_private.hydrate_driver_delivery_proof_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
  v_details jsonb;
begin
  if jsonb_typeof(new.metadata) <> 'object'
    or coalesce(new.metadata->>'event_id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_event_id := (new.metadata->>'event_id')::uuid;
  select event.payload->'delivery_request'->'details' into v_details
  from public.dispatch_events as event
  where event.id = v_event_id
    and event.tenant_id = new.tenant_id
    and event.dispatch_trip_id = new.dispatch_trip_id
    and event.dispatch_stop_id = new.dispatch_stop_id
    and event.event_type in ('delivery_delivered','stop_partial_delivery');
  if not found or jsonb_typeof(v_details) <> 'object' then return new; end if;

  new.latitude := (v_details->>'latitude')::numeric;
  new.longitude := (v_details->>'longitude')::numeric;
  new.accuracy := (v_details->>'accuracy_m')::numeric;
  new.metadata := new.metadata || jsonb_strip_nulls(jsonb_build_object(
    'receipt_original_path',v_details->'receipt_original_path',
    'receipt_processed_path',v_details->'receipt_processed_path',
    'receipt_thumbnail_path',v_details->'receipt_thumbnail_path',
    'receipt_original_hash',v_details->'receipt_original_hash',
    'receipt_processed_hash',v_details->'receipt_processed_hash',
    'receipt_thumbnail_hash',v_details->'receipt_thumbnail_hash',
    'receipt_scan_mode',v_details->'receipt_scan_mode',
    'receipt_scan_quality',v_details->'receipt_scan_quality',
    'receipt_crop',v_details->'receipt_crop',
    'receipt_corners',v_details->'receipt_corners',
    'receipt_rotation',v_details->'receipt_rotation',
    'receipt_quality_confirmed',v_details->'receipt_quality_confirmed',
    'receipt_quality_policy',v_details->'receipt_quality_policy',
    'captured_at',v_details->'captured_at',
    'latitude',v_details->'latitude',
    'longitude',v_details->'longitude',
    'accuracy_m',v_details->'accuracy_m'
  ));
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'driver_delivery_gps_invalid' using errcode = '22023';
end;
$function$;

revoke all on function delivery_private.hydrate_driver_delivery_proof_evidence_v1()
  from public, anon, authenticated, service_role;

-- Alphabetical trigger ordering makes hydration run before the quality-policy
-- normalizer and before the existing AFTER trigger materializes the canhoto.
create trigger hydrate_driver_delivery_proof_evidence_v1
before insert or update of metadata on public.proof_of_delivery
for each row execute function delivery_private.hydrate_driver_delivery_proof_evidence_v1();

comment on function delivery_private.validate_driver_delivery_dispatch_evidence_v1() is
  'Database boundary for driver evidence: refusal/return needs a photo and delivered/partial needs an accurate GPS snapshot.';
comment on function delivery_private.hydrate_driver_delivery_proof_evidence_v1() is
  'Copies the immutable driver delivery evidence snapshot and GPS into proof_of_delivery before the canonical receipt is materialized.';
