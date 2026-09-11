-- Conflicting attempts are immutable evidence, not permanent poison. An
-- operator can discard one explicitly; the driver then starts a fresh request.
alter table public.driver_delivery_fiscal_conflicts
  add column if not exists delivery_payload jsonb,
  add column resolution_action text,
  add column resolution_request_id uuid,
  add column resolution_payload_hash text;
alter table public.driver_delivery_fiscal_conflicts
  add constraint driver_delivery_fiscal_conflicts_resolution_action_chk
    check(resolution_action is null or resolution_action='discard'),
  add constraint driver_delivery_fiscal_conflicts_resolution_request_key unique(resolution_request_id),
  add constraint driver_delivery_fiscal_conflicts_resolution_hash_chk
    check(resolution_payload_hash is null or resolution_payload_hash~'^[0-9a-f]{32}$');

-- A discarded conflict still owns its uploaded canhoto/signature/photos. The
-- replacement preserves the function OID, so both direct object deletes and
-- authorize_secure_upload_cleanup_v1 immediately see the extended predicate.
create or replace function storage_evidence_private.is_retained(
  _bucket text,_path text,_tenant_id uuid default null
) returns boolean language plpgsql stable security definer set search_path='' as $function$
begin
  if _bucket='receipts' then
    return
      exists(select 1 from public.driver_delivery_fiscal_conflicts conflict
        where (_tenant_id is null or conflict.tenant_id=_tenant_id) and (
          conflict.delivery_payload->>'receipt_original_path'=_path
          or conflict.delivery_payload->>'receipt_processed_path'=_path
          or conflict.delivery_payload->>'receipt_thumbnail_path'=_path
          or conflict.delivery_payload->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(
            conflict.delivery_payload->'photo_paths',_path)))
      or exists(select 1 from public.proof_of_delivery proof
        where (_tenant_id is null or proof.tenant_id=_tenant_id)
          and coalesce(nullif(proof.storage_bucket,''),'receipts')='receipts'
          and (proof.storage_path=_path or proof.photo_url=_path or proof.signature_url=_path
            or proof.metadata->>'signature_path'=_path
            or storage_evidence_private.array_contains_path(proof.metadata->'photo_paths',_path)))
      or exists(select 1 from public.dispatch_events event
        where (_tenant_id is null or event.tenant_id=_tenant_id) and (
          event.payload->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(event.payload->'photo_paths',_path)
          or event.payload#>>'{details,signature_path}'=_path
          or storage_evidence_private.array_contains_path(event.payload#>'{details,photo_paths}',_path)
          or event.payload#>>'{delivery_request,details,signature_path}'=_path
          or storage_evidence_private.array_contains_path(
            event.payload#>'{delivery_request,details,photo_paths}',_path)))
      or exists(select 1 from public.operational_events event
        where (_tenant_id is null or event.tenant_id=_tenant_id) and (
          event.report_details->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(event.report_details->'photo_paths',_path)
          or event.payload->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(event.payload->'photo_paths',_path)))
      or exists(select 1 from public.driver_expenses expense
        where (_tenant_id is null or expense.tenant_id=_tenant_id) and expense.receipt_url=_path)
      or exists(select 1 from public.driver_settlement_payments payment
        where (_tenant_id is null or payment.tenant_id=_tenant_id) and payment.receipt_url=_path)
      or exists(select 1 from public.payables payable
        where (_tenant_id is null or payable.tenant_id=_tenant_id) and payable.receipt_url=_path);
  elsif _bucket='occurrence-return-proofs' then
    return exists(select 1 from public.occurrence_return_sheets sheet
      where (_tenant_id is null or sheet.tenant_id=_tenant_id) and sheet.signed_proof_url=_path);
  elsif _bucket='pallet-return-proofs' then
    return exists(select 1 from public.pallet_return_protocols protocol
      where (_tenant_id is null or protocol.tenant_id=_tenant_id) and protocol.signed_proof_url=_path);
  end if;
  return false;
end;$function$;
revoke all on function storage_evidence_private.is_retained(text,text,uuid)
  from public,anon,authenticated,service_role;
revoke select on table public.driver_delivery_fiscal_conflicts from authenticated;
drop policy if exists driver_delivery_fiscal_conflicts_read on public.driver_delivery_fiscal_conflicts;

create or replace function public.resolve_driver_delivery_fiscal_conflict_v1(
  _tenant_id uuid,_request_id uuid,_resolution_request_id uuid,_action text,_reason text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_conflict public.driver_delivery_fiscal_conflicts%rowtype;v_hash text;v_result jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'delivery_fiscal_conflict_not_authorized' using errcode='42501';end if;
  if _request_id is null or _resolution_request_id is null or _action<>'discard'
    or length(btrim(coalesce(_reason,''))) not between 10 and 1000 then
    raise exception 'delivery_fiscal_conflict_resolution_invalid' using errcode='22023';end if;
  v_hash:=md5(jsonb_build_object('conflict_request_id',_request_id,'action',_action,
    'reason',btrim(_reason))::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('driver_delivery:'||_request_id::text,0));
  select * into v_conflict from public.driver_delivery_fiscal_conflicts
    where tenant_id=_tenant_id and request_id=_request_id for update;
  if not found then raise exception 'delivery_fiscal_conflict_not_found' using errcode='P0002';end if;
  perform stop.id from public.dispatch_stops stop where stop.id=v_conflict.dispatch_stop_id for update;
  if v_conflict.status='resolved' then
    if v_conflict.resolution_request_id is distinct from _resolution_request_id
      or v_conflict.resolution_payload_hash is distinct from v_hash then
      raise exception 'delivery_fiscal_conflict_already_resolved' using errcode='23505';end if;
    return v_conflict.result||jsonb_build_object('replayed',true);
  end if;
  v_result:=v_conflict.result||jsonb_build_object('confirmed',false,'conflict',true,
    'status','resolved','resolution_action','discard','replacement_required',true,
    'resolved_at',clock_timestamp(),'resolved_by',auth.uid(),'replayed',false);
  update public.driver_delivery_fiscal_conflicts set status='resolved',resolved_at=clock_timestamp(),
    resolved_by=auth.uid(),resolution_reason=btrim(_reason),resolution_action='discard',
    resolution_request_id=_resolution_request_id,resolution_payload_hash=v_hash,result=v_result
    where request_id=_request_id returning result into v_result;
  perform public._log_entity_audit(_tenant_id,'driver_delivery_fiscal_conflict',_request_id,
    'conflicting_delivery_attempt_discarded',jsonb_build_object('status','pending'),
    jsonb_build_object('status','resolved','action','discard','stop_id',v_conflict.dispatch_stop_id,
      'trip_id',v_conflict.dispatch_trip_id,'reason',btrim(_reason),'resolution_request_id',_resolution_request_id),
    'operations');
  return v_result;
end;$function$;
revoke all on function public.resolve_driver_delivery_fiscal_conflict_v1(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.resolve_driver_delivery_fiscal_conflict_v1(uuid,uuid,uuid,text,text)
  to authenticated;

create or replace function public.get_driver_delivery_fiscal_conflict_v1(_tenant_id uuid,_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_conflict public.driver_delivery_fiscal_conflicts%rowtype;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id then
    raise exception 'delivery_fiscal_conflict_not_authorized' using errcode='42501';end if;
  select * into v_conflict from public.driver_delivery_fiscal_conflicts
    where tenant_id=_tenant_id and request_id=_request_id;
  if not found then raise exception 'delivery_fiscal_conflict_not_found' using errcode='P0002';end if;
  if v_conflict.actor_id<>auth.uid() then
    raise exception 'delivery_fiscal_conflict_not_authorized' using errcode='42501';end if;
  return jsonb_build_object('version',1,'request_id',v_conflict.request_id,'trip_id',v_conflict.dispatch_trip_id,
    'stop_id',v_conflict.dispatch_stop_id,'status',v_conflict.status,'resolution_action',v_conflict.resolution_action,
    'resolution_reason',v_conflict.resolution_reason,'resolved_at',v_conflict.resolved_at,
    'replacement_required',v_conflict.status='resolved' and v_conflict.resolution_action='discard');
end;$function$;
revoke all on function public.get_driver_delivery_fiscal_conflict_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_driver_delivery_fiscal_conflict_v1(uuid,uuid) to authenticated;

create or replace function public.get_operations_delivery_fiscal_conflict_v1(_tenant_id uuid,_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_conflict public.driver_delivery_fiscal_conflicts%rowtype;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'delivery_fiscal_conflict_not_authorized' using errcode='42501';end if;
  select * into v_conflict from public.driver_delivery_fiscal_conflicts
    where tenant_id=_tenant_id and request_id=_request_id;
  if not found then raise exception 'delivery_fiscal_conflict_not_found' using errcode='P0002';end if;
  return jsonb_build_object('version',1,'request_id',v_conflict.request_id,'trip_id',v_conflict.dispatch_trip_id,
    'stop_id',v_conflict.dispatch_stop_id,'actor_id',v_conflict.actor_id,'status',v_conflict.status,
    'expected_revision',v_conflict.expected_revision,'actual_revision',v_conflict.actual_revision,
    'expected_document_count',coalesce(jsonb_array_length(v_conflict.expected_snapshot->'documents'),0),
    'actual_document_count',coalesce(jsonb_array_length(v_conflict.actual_snapshot->'documents'),0),
    'created_at',v_conflict.created_at,'resolution_action',v_conflict.resolution_action,
    'resolution_reason',v_conflict.resolution_reason,'resolved_at',v_conflict.resolved_at,
    'replacement_required',v_conflict.status='resolved' and v_conflict.resolution_action='discard');
end;$function$;
revoke all on function public.get_operations_delivery_fiscal_conflict_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_delivery_fiscal_conflict_v1(uuid,uuid) to authenticated;

-- These service-only legacy signatures cannot carry the mandatory GPS,
-- receipt-scan hashes/quality and fiscal precondition. Fail explicitly rather
-- than fabricate evidence or bypass the canonical writer. Runtime has no caller.
create or replace function public.driver_finalize_delivery(_stop_id uuid,_receiver_name text,
  _signature_path text default null,_photo_paths text[] default array[]::text[],
  _receiver_document text default null,_receiver_role text default null,_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  raise exception 'driver_legacy_delivery_contract_retired' using errcode='55000',
    hint='Use driver_record_delivery_outcome with request_id, GPS, receipt scan integrity and fiscal_snapshot.';
end;$function$;
create or replace function public.driver_update_stop_status(_stop_id uuid,_new_status text,_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
begin
  raise exception 'driver_legacy_delivery_contract_retired' using errcode='55000',
    hint='Use the scoped arrival/departure RPCs or driver_record_delivery_outcome with complete evidence.';
end;$function$;
revoke all on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text),
  public.driver_update_stop_status(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text),
  public.driver_update_stop_status(uuid,text,text) to service_role;

comment on function public.resolve_driver_delivery_fiscal_conflict_v1(uuid,uuid,uuid,text,text) is
  'Operator/admin discards an immutable conflicting attempt; the replacement must use a new request id and current NF-e/NFS-e snapshot.';

do $privacy_postcondition$
begin
  if has_table_privilege('authenticated','public.driver_delivery_fiscal_conflicts','select')
    or not has_function_privilege('authenticated','public.get_driver_delivery_fiscal_conflict_v1(uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.get_operations_delivery_fiscal_conflict_v1(uuid,uuid)','execute') then
    raise exception 'driver_delivery_fiscal_conflict_privacy_contract_failed';end if;
end;$privacy_postcondition$;
