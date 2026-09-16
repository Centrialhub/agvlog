set local lock_timeout='5s';
set local statement_timeout='60s';

do $replace_threshold$
declare
  v_definition text:=pg_get_functiondef('public.ack_address_resolution_queue_item_v2(jsonb)'::regprocedure);
  v_old text:='coalesce(v_confidence,0)>=0.4 and coalesce(v_accuracy,100000)<=250';
  v_new text:='coalesce(v_confidence,0)>=0.75 and coalesce(v_accuracy,100000)<=250';
begin
  if position(v_new in v_definition)>0 then return;end if;
  if position(v_old in v_definition)=0 then
    raise exception 'geocoding_auto_resolution_threshold_signature_changed';
  end if;
  execute replace(v_definition,v_old,v_new);
end;
$replace_threshold$;

-- Candidate quality semantics changed from Nominatim popularity to address
-- granularity. Only unresolved cached results are discarded and retried.
delete from public.address_geocoding_cache cache
where exists(
  select 1 from public.address_resolution_queue q
  where q.tenant_id=cache.tenant_id and q.address_hash=cache.address_hash
    and q.entity_type='client' and q.status in ('error','ambiguous')
    and q.resolution_kind='auto_candidates'
);

update public.canonical_addresses a set status='pending',updated_at=clock_timestamp()
where a.status in ('error','ambiguous') and exists(
  select 1 from public.address_resolution_queue q
  where q.tenant_id=a.tenant_id and q.canonical_address_id=a.id and q.entity_type='client'
    and q.status in ('error','ambiguous') and q.resolution_kind='auto_candidates'
);

update public.clients c set address_geocode_status='pending'
where c.address_geocode_status in ('error','ambiguous') and exists(
  select 1 from public.address_resolution_queue q
  where q.tenant_id=c.tenant_id and q.entity_type='client' and q.entity_id=c.id
    and q.status in ('error','ambiguous') and q.resolution_kind='auto_candidates'
);

update public.address_resolution_queue set
  status='pending',candidates='[]'::jsonb,attempts=0,last_error=null,
  processed_at=null,next_attempt_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
  last_worker_request_key=null,resolution_kind=null,
  resolution_details=jsonb_build_object('retry_reason','geocoding_quality_recalibrated'),
  updated_at=clock_timestamp()
where entity_type='client' and status in ('error','ambiguous') and resolution_kind='auto_candidates';

do $postcondition$
begin
  if position('coalesce(v_confidence,0)>=0.75' in pg_get_functiondef(
      'public.ack_address_resolution_queue_item_v2(jsonb)'::regprocedure))=0 then
    raise exception 'geocoding_quality_calibration_postcondition_failed';
  end if;
end;
$postcondition$;
