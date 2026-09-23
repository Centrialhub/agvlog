-- Record the review queue and the client status in one transaction. A stale
-- caller must not attach candidates to a different canonical address.
create or replace function public.record_address_entity_candidates_v1(
  _tenant_id uuid,
  _entity_type text,
  _entity_id uuid,
  _address_snapshot text,
  _address_hash text,
  _candidates jsonb
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_canonical_id uuid;
  v_locked_canonical_id uuid;
  v_hash text;
  v_existing_status text;
  v_existing_hash text;
  v_status text;
  v_queue_id uuid;
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _tenant_id is null or _entity_id is null or coalesce(_entity_type, '') not in ('client', 'dispatch_stop')
    or length(btrim(coalesce(_address_snapshot, ''))) not between 8 and 500
    or coalesce(_address_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(_candidates) is distinct from 'array' then
    raise exception 'invalid_address_candidates' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(_candidates);
  if v_count > 5 then raise exception 'too_many_address_candidates' using errcode = '22023'; end if;

  select status, address_hash into v_existing_status, v_existing_hash
  from public.address_resolution_queue
  where tenant_id = _tenant_id and entity_type = _entity_type and entity_id = _entity_id
  for update;
  if v_existing_status = 'resolved' and v_existing_hash = _address_hash then
    raise exception 'address_review_already_resolved' using errcode = '23514';
  end if;

  if _entity_type = 'client' then
    select canonical_address_id into v_canonical_id from public.clients
      where tenant_id = _tenant_id and id = _entity_id;
  else
    select canonical_address_id into v_canonical_id from public.dispatch_stops
      where tenant_id = _tenant_id and id = _entity_id;
  end if;
  if v_canonical_id is null then
    raise exception 'address_subject_changed' using errcode = '40001';
  end if;
  select address_hash into v_hash from public.canonical_addresses
    where tenant_id = _tenant_id and id = v_canonical_id for share;
  if v_hash is distinct from _address_hash then
    raise exception 'address_subject_changed' using errcode = '40001';
  end if;
  if _entity_type = 'client' then
    select canonical_address_id into v_locked_canonical_id from public.clients
      where tenant_id = _tenant_id and id = _entity_id for update;
  else
    select canonical_address_id into v_locked_canonical_id from public.dispatch_stops
      where tenant_id = _tenant_id and id = _entity_id for update;
  end if;
  if v_locked_canonical_id is distinct from v_canonical_id then
    raise exception 'address_subject_changed' using errcode = '40001';
  end if;

  v_status := case when v_count = 0 then 'error' when v_count = 1 then 'pending' else 'ambiguous' end;
  insert into public.address_resolution_queue (
    tenant_id, entity_type, entity_id, canonical_address_id, address_snapshot, address_hash,
    status, candidates, attempts, last_error, processed_at, next_attempt_at, updated_at
  ) values (
    _tenant_id, _entity_type, _entity_id, v_canonical_id, _address_snapshot, _address_hash,
    v_status, _candidates, 1, case when v_count = 0 then 'no_candidates' else null end,
    case when v_count = 0 then null else v_now end,
    v_now + case when v_count = 0 then interval '60 seconds' else interval '0 seconds' end, v_now
  ) on conflict (tenant_id, entity_type, entity_id) do update set
    canonical_address_id = excluded.canonical_address_id,
    address_snapshot = excluded.address_snapshot,
    address_hash = excluded.address_hash,
    status = excluded.status,
    candidates = excluded.candidates,
    attempts = 1,
    last_error = excluded.last_error,
    processed_at = excluded.processed_at,
    next_attempt_at = excluded.next_attempt_at,
    resolved_lat = null, resolved_lng = null, resolved_provider = null,
    resolved_accuracy_m = null, resolved_confidence = null,
    resolved_at = null, resolved_by = null,
    lease_token = null, lease_expires_at = null,
    updated_at = excluded.updated_at
  returning id into v_queue_id;

  if _entity_type = 'client' then
    update public.clients set address_geocode_status = v_status
      where tenant_id = _tenant_id and id = _entity_id and canonical_address_id = v_canonical_id;
    if not found then raise exception 'address_subject_changed' using errcode = '40001'; end if;
  end if;
  return jsonb_build_object('queue_id', v_queue_id, 'status', v_status, 'candidate_count', v_count);
end;
$function$;

revoke all on function public.record_address_entity_candidates_v1(uuid,text,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_address_entity_candidates_v1(uuid,text,uuid,text,text,jsonb)
  to service_role;
