create or replace function private.resolve_address_queue_item_v2(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_id uuid:=nullif(_payload->>'queue_id','')::uuid;v_actor uuid:=auth.uid();v_hash text;
  v_existing public.operator_command_ledger%rowtype;v_item public.address_resolution_queue%rowtype;
  v_lat double precision:=nullif(_payload->>'latitude','')::double precision;
  v_lng double precision:=nullif(_payload->>'longitude','')::double precision;v_provider text:=nullif(_payload->>'provider','');
  v_accuracy double precision:=nullif(_payload->>'accuracy_m','')::double precision;
  v_confidence double precision:=nullif(_payload->>'confidence','')::double precision;
  v_label text:=nullif(_payload->>'label','');
  v_kind text:=coalesce(nullif(_payload->>'selection_kind',''),'assisted_candidate');v_details jsonb;v_result jsonb;
begin
  if v_actor is null or v_tenant is null or v_request is null or v_id is null
    or private.request_tenant_id() is distinct from v_tenant or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if v_lat is null or v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180 or v_provider is null
    or v_kind not in ('assisted_candidate','manual_map') or (v_kind='manual_map' and v_provider<>'leaflet_map') then
    raise exception 'invalid_address_resolution' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||v_tenant::text||':'||v_request::text,0));
  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_existing from public.operator_command_ledger
    where tenant_id=v_tenant and request_id=v_request;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'resolve_address' or v_existing.entity_id<>v_id
      or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';end if;
    return v_existing.response;
  end if;
  select * into v_item from public.address_resolution_queue where id=v_id and tenant_id=v_tenant for update;
  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if not found or v_item.status not in ('pending','ambiguous','error') then
    raise exception 'address_resolution_not_available' using errcode='23514';end if;
  if v_kind='assisted_candidate' and not exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(v_item.candidates)='array' then v_item.candidates else '[]'::jsonb end
    ) as candidate(value)
    where jsonb_typeof(candidate.value)='object'
      and jsonb_typeof(candidate.value->'latitude')='number'
      and jsonb_typeof(candidate.value->'longitude')='number'
      and jsonb_typeof(candidate.value->'accuracy_m')='number'
      and jsonb_typeof(candidate.value->'confidence')='number'
      and (candidate.value->>'latitude')::double precision=v_lat
      and (candidate.value->>'longitude')::double precision=v_lng
      and candidate.value->>'provider'=v_provider
      and (candidate.value->>'accuracy_m')::double precision is not distinct from v_accuracy
      and (candidate.value->>'confidence')::double precision is not distinct from v_confidence
      and candidate.value->>'label'=v_label
  ) then
    raise exception 'address_assisted_candidate_mismatch' using errcode='22023';
  end if;
  v_details:=jsonb_build_object('selected_label',left(coalesce(v_label,'Ponto ajustado no mapa'),500),
    'selection',v_kind,'previous_lat',nullif(_payload->>'previous_lat','')::double precision,
    'previous_lng',nullif(_payload->>'previous_lng','')::double precision,'request_id',v_request);
  update public.canonical_addresses set status='verified',latitude=v_lat,longitude=v_lng,provider=v_provider,
    accuracy_m=v_accuracy,confidence=v_confidence,resolved_at=clock_timestamp(),
    resolved_by=v_actor,updated_at=clock_timestamp()
  where tenant_id=v_tenant and id=v_item.canonical_address_id and address_hash=v_item.address_hash;
  if not found then raise exception 'address_changed_during_resolution' using errcode='40001';end if;
  update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
    address_geocode_provider=v_provider,address_geocode_accuracy_m=v_accuracy,
    address_geocode_confidence=v_confidence,address_geocoded_at=clock_timestamp(),
    address_geocoded_by=v_actor,address_geocode_hash=v_item.address_hash,address_geocode_audit=v_details
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id;
  update public.dispatch_stops set latitude=v_lat,longitude=v_lng,location_source='address_geocoded',
    location_address=(select normalized_address from public.canonical_addresses where id=v_item.canonical_address_id),
    location_provider=v_provider,location_accuracy_m=v_accuracy,
    location_confidence=v_confidence,location_resolved_at=clock_timestamp(),
    location_resolved_by=v_actor,location_verification_status='verified',location_invalidated_at=null,
    location_audit=coalesce(location_audit,'{}'::jsonb)||v_details
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id
    and location_source<>'map_selected' and not(status=any(public.stop_terminal_statuses()));
  update public.address_resolution_queue set status='resolved',resolved_lat=v_lat,resolved_lng=v_lng,
    resolved_provider=v_provider,resolved_accuracy_m=v_accuracy,
    resolved_confidence=v_confidence,resolved_at=clock_timestamp(),
    resolved_by=v_actor,processed_at=coalesce(processed_at,clock_timestamp()),lease_token=null,lease_expires_at=null,
    resolution_kind=v_kind,resolution_details=v_details,updated_at=clock_timestamp()
  where tenant_id=v_tenant and canonical_address_id=v_item.canonical_address_id
    and status in ('pending','ambiguous','error');
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'queue_id',v_id,
    'canonical_address_id',v_item.canonical_address_id,'selection_kind',v_kind);
  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
    values(v_tenant,v_request,v_actor,'resolve_address',v_item.entity_type,v_id,v_hash,v_result);
  return v_result;
end;
$function$;

revoke all on function private.resolve_address_queue_item_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.resolve_address_queue_item_v2(jsonb) to authenticated;
