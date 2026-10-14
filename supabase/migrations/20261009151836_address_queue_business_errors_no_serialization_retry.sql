-- Production migration20261009151836 already applied by coordinator.
-- Reconstructed from exact live postconditions; do not apply again on production.
-- Preserve its version in repository. No cron or data mutation.
BEGIN;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ack_address_resolution_queue_item_v2(jsonb)');
  IF pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.proacl::text<>'{postgres=X/postgres,service_role=X/postgres}' OR p.provolatile<>'v'
     OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') NOT IN ('cb54088d3388c9bb6acb93fd490faef77de9498a990027872d43a2dbdf9fa7f6','6b729ae94fbb7aac38160d5a519479a6a1e17112ec6284d313b14be1959bdf4f') THEN
    RAISE EXCEPTION 'queue_containment_pre_definition_or_privilege_drift';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.ack_address_resolution_queue_item_v2(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid:=nullif(_payload->>'queue_id','')::uuid;
  v_token uuid:=nullif(_payload->>'lease_token','')::uuid;
  v_request text:=nullif(_payload->>'request_key','');
  v_hash text:=nullif(_payload->>'address_hash','');
  v_candidates jsonb:=_payload->'candidates';
  v_candidate jsonb;
  v_item public.address_resolution_queue%rowtype;
  v_error text:=nullif(left(btrim(_payload->>'error'),300),'');
  v_count integer:=0;
  v_retry_ms integer:=greatest(0,least(coalesce(nullif(_payload->>'retry_after_ms','')::integer,0),3600000));
  v_status text;
  v_now timestamptz:=clock_timestamp();
  v_lat double precision;
  v_lng double precision;
  v_provider text;
  v_accuracy double precision;
  v_confidence double precision;
  v_auto_resolve boolean:=false;
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if v_id is null or v_token is null or v_request is null or length(v_request)>500 or v_hash is null then
    raise exception 'invalid_address_queue_ack' using errcode='22023';end if;
  select * into v_item from public.address_resolution_queue where id=v_id for update;
  if not found then raise exception 'address_queue_item_not_found' using errcode='P0002';end if;
  if v_item.address_hash is distinct from v_hash then raise exception 'address_queue_hash_changed' using errcode='P0001';end if;
  if v_item.last_worker_request_key=v_request then
    return jsonb_build_object('ok',true,'idempotent',true,'queue_id',v_id,'status',v_item.status);
  end if;
  if v_item.lease_token is distinct from v_token or v_item.lease_expires_at<=v_now then
    raise exception 'address_queue_lease_lost' using errcode='P0001';end if;
  if v_candidates is not null and jsonb_typeof(v_candidates)<>'array' then
    raise exception 'invalid_geocoding_candidates' using errcode='22023';end if;
  if v_candidates is not null then v_count:=jsonb_array_length(v_candidates);end if;
  if v_count>5 then raise exception 'too_many_geocoding_candidates' using errcode='22023';end if;

  if v_count=1 then
    v_candidate:=v_candidates->0;
    begin
      v_lat:=nullif(v_candidate->>'latitude','')::double precision;
      v_lng:=nullif(v_candidate->>'longitude','')::double precision;
      v_provider:=nullif(left(btrim(v_candidate->>'provider'),100),'');
      v_accuracy:=nullif(v_candidate->>'accuracy_m','')::double precision;
      v_confidence:=nullif(v_candidate->>'confidence','')::double precision;
      v_auto_resolve:=v_lat between -90 and 90 and v_lng between -180 and 180
        and v_provider is not null and coalesce(v_confidence,0)>=0.75 and coalesce(v_accuracy,100000)<=250;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_auto_resolve:=false;
    end;
  end if;

  if v_auto_resolve then
    perform pg_advisory_xact_lock(hashtextextended('canonical_address:'||v_item.tenant_id::text||':'||v_item.canonical_address_id::text,0));
    update public.canonical_addresses set status='verified',latitude=v_lat,longitude=v_lng,provider=v_provider,
      accuracy_m=v_accuracy,confidence=v_confidence,resolved_at=v_now,resolved_by=null,updated_at=v_now
    where tenant_id=v_item.tenant_id and id=v_item.canonical_address_id and address_hash=v_item.address_hash;
    if not found then raise exception 'address_changed_during_resolution' using errcode='P0001';end if;
    update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
      address_geocode_provider=v_provider,address_geocode_accuracy_m=v_accuracy,address_geocode_confidence=v_confidence,
      address_geocoded_at=v_now,address_geocoded_by=null,address_geocode_hash=v_item.address_hash,
      address_geocode_audit=coalesce(address_geocode_audit,'{}'::jsonb)||jsonb_build_object(
        'selection','automatic_unique_candidate','queue_id',v_id,'selected_label',left(v_candidate->>'label',500))
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id;
    update public.dispatch_stops set latitude=v_lat,longitude=v_lng,location_source='address_geocoded',
      location_address=(select normalized_address from public.canonical_addresses where id=v_item.canonical_address_id),
      location_provider=v_provider,location_accuracy_m=v_accuracy,location_confidence=v_confidence,
      location_resolved_at=v_now,location_resolved_by=null,location_verification_status='verified',
      location_invalidated_at=null,location_audit=coalesce(location_audit,'{}'::jsonb)||jsonb_build_object(
        'selection','automatic_unique_candidate','queue_id',v_id,'selected_label',left(v_candidate->>'label',500))
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id
      and location_source<>'map_selected' and not(status=any(public.stop_terminal_statuses()));
    update public.address_resolution_queue set status='resolved',candidates=v_candidates,attempts=attempts+1,
      last_error=null,resolved_lat=v_lat,resolved_lng=v_lng,resolved_provider=v_provider,
      resolved_accuracy_m=v_accuracy,resolved_confidence=v_confidence,resolved_at=v_now,resolved_by=null,
      processed_at=coalesce(processed_at,v_now),lease_token=null,lease_expires_at=null,
      last_worker_request_key=case when id=v_id then v_request else last_worker_request_key end,
      resolution_kind='auto_candidates',resolution_details=jsonb_build_object(
        'cache',_payload->>'cache','candidate_count',1,'selection','automatic_unique_candidate',
        'selected_label',left(v_candidate->>'label',500)),updated_at=v_now
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id
      and status in ('pending','ambiguous','error');
    perform private.sync_fleet_geofences_for_canonical_v1(v_item.tenant_id,v_item.canonical_address_id);
    return jsonb_build_object('ok',true,'idempotent',false,'queue_id',v_id,'status','resolved',
      'candidate_count',1,'automatic',true);
  end if;

  v_status:=case when v_error is not null or v_count=0 then 'error' else 'ambiguous' end;
  update public.address_resolution_queue set status=v_status,candidates=coalesce(v_candidates,'[]'::jsonb),
    attempts=attempts+1,last_error=case when v_status='error' then coalesce(v_error,'no_candidates') else null end,
    processed_at=case when v_status='error' then null else v_now end,
    next_attempt_at=case when v_status='error' then v_now+make_interval(secs=>greatest(
      ceil(v_retry_ms/1000.0)::integer,least(3600,(power(2,least(attempts+1,6))*60)::integer))) else v_now end,
    lease_token=null,lease_expires_at=null,last_worker_request_key=v_request,resolution_kind='auto_candidates',
    resolution_details=jsonb_build_object('cache',_payload->>'cache','candidate_count',v_count,
      'automatic',false,'review_reason',case when v_count=1 then 'low_confidence' else 'multiple_candidates' end),
    updated_at=v_now
  where id=v_id;
  update public.clients set address_geocode_status=v_status
    where tenant_id=v_item.tenant_id and id=v_item.entity_id and address_geocode_hash=v_item.address_hash;
  update public.canonical_addresses set status=v_status,updated_at=v_now
    where tenant_id=v_item.tenant_id and id=v_item.canonical_address_id and status<>'verified' and v_status='ambiguous';
  return jsonb_build_object('ok',true,'idempotent',false,'queue_id',v_id,'status',v_status,
    'candidate_count',v_count,'automatic',false);
end;
$function$ ;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ack_address_resolution_queue_item_v2(jsonb)');
  IF pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.proacl::text<>'{postgres=X/postgres,service_role=X/postgres}' OR p.provolatile<>'v'
     OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') NOT IN ('6b729ae94fbb7aac38160d5a519479a6a1e17112ec6284d313b14be1959bdf4f') THEN
    RAISE EXCEPTION 'queue_containment_post_definition_or_privilege_drift';
  END IF;
END;
$guard$;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.get_claimed_address_resolution_item_v1(uuid,uuid)');
  IF pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.proacl::text<>'{postgres=X/postgres,service_role=X/postgres}' OR p.provolatile<>'v'
     OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') NOT IN ('15b47df33cece2dc9f3355cb3e079140ab2d4b98a519c81025efd8549038e5a8','9e2453050463d1b7e442d7fe5bb9e1a41e2bc2d01f6f5b140123df359f78eece') THEN
    RAISE EXCEPTION 'queue_containment_pre_definition_or_privilege_drift';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.get_claimed_address_resolution_item_v1(_queue_id uuid, _lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_item public.address_resolution_queue%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_item from public.address_resolution_queue q where q.id=_queue_id and q.lease_token=_lease_token
    and q.lease_expires_at>clock_timestamp();
  if not found then raise exception 'address_queue_claim_not_available' using errcode='P0001';end if;
  return jsonb_build_object('id',v_item.id,'tenant_id',v_item.tenant_id,'entity_type',v_item.entity_type,
    'entity_id',v_item.entity_id,'address_snapshot',v_item.address_snapshot,'address_hash',v_item.address_hash);
end;
$function$ ;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.get_claimed_address_resolution_item_v1(uuid,uuid)');
  IF pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.proacl::text<>'{postgres=X/postgres,service_role=X/postgres}' OR p.provolatile<>'v'
     OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') NOT IN ('9e2453050463d1b7e442d7fe5bb9e1a41e2bc2d01f6f5b140123df359f78eece') THEN
    RAISE EXCEPTION 'queue_containment_post_definition_or_privilege_drift';
  END IF;
END;
$guard$;
COMMIT;
