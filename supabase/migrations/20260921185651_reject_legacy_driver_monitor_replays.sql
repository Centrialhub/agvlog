create or replace function public.import_driver_monitoring_workbook_v1(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id', '')::uuid;
  v_request uuid := nullif(_payload->>'request_id', '')::uuid;
  v_fingerprint text := lower(nullif(_payload->>'file_fingerprint', ''));
  v_payload_hash text;
  v_first_lock text;
  v_second_lock text;
  v_match_count integer;
  v_existing public.driver_monitoring_import_batches%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant)
     or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if v_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  if v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'file_fingerprint_invalid' using errcode = '22023';
  end if;

  v_payload_hash := encode(sha256(convert_to((_payload - 'request_id')::text, 'UTF8')), 'hex');
  v_first_lock := least('fingerprint:' || v_fingerprint, 'request:' || v_request::text);
  v_second_lock := greatest('fingerprint:' || v_fingerprint, 'request:' || v_request::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text || ':' || v_first_lock, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant::text || ':' || v_second_lock, 0));

  select count(distinct batch.id) into v_match_count
  from public.driver_monitoring_import_batches batch
  where batch.tenant_id = v_tenant
    and (batch.file_fingerprint = v_fingerprint or batch.request_id = v_request);
  if v_match_count > 1 then
    raise exception 'driver_monitoring_idempotency_keys_diverged' using errcode = '22023';
  end if;

  select * into v_existing
  from public.driver_monitoring_import_batches batch
  where batch.tenant_id = v_tenant
    and (batch.file_fingerprint = v_fingerprint or batch.request_id = v_request)
  limit 1
  for update;
  if found then
    if v_existing.file_fingerprint is distinct from v_fingerprint
       or v_existing.request_id is distinct from v_request
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'driver_monitoring_request_payload_mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'importedMonitors', v_existing.imported_monitors,
      'importedUpdates', v_existing.imported_updates,
      'importedForecasts', v_existing.imported_forecasts,
      'errors', v_existing.errors,
      'duplicate', true
    );
  end if;

  v_result := private.import_driver_monitoring_workbook_unsafe_20260917(_payload);
  update public.driver_monitoring_import_batches
  set payload_hash = v_payload_hash
  where tenant_id = v_tenant
    and request_id = v_request
    and file_fingerprint = v_fingerprint;
  if not found then
    raise exception 'driver_monitoring_batch_not_persisted' using errcode = '40001';
  end if;
  return v_result;
end;
$function$;

comment on function public.import_driver_monitoring_workbook_v1(jsonb) is
  'Imports one workbook atomically. Legacy batches without a provable payload hash cannot be replayed; current replays require identical request, fingerprint, and payload hash.';
