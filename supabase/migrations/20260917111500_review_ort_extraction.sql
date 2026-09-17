create or replace function public.review_ort_extraction_v1(
  _tenant_id uuid,
  _audit_id uuid,
  _decision text,
  _reviewed_payload jsonb,
  _expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_audit public.ort_extraction_audits%rowtype;
  v_status text;
  v_old jsonb;
begin
  if auth.uid() is null
     or not private.is_request_tenant_member(_tenant_id)
     or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'ort_review_not_authorized' using errcode = '42501';
  end if;
  if _decision not in ('approve', 'reject') then
    raise exception 'ort_review_invalid_decision' using errcode = '22023';
  end if;
  if _reviewed_payload is null or jsonb_typeof(_reviewed_payload) <> 'object' then
    raise exception 'ort_review_payload_required' using errcode = '22023';
  end if;

  select * into v_audit
  from public.ort_extraction_audits
  where id = _audit_id and tenant_id = _tenant_id
  for update;
  if not found then
    raise exception 'ort_review_not_found' using errcode = 'P0002';
  end if;
  if v_audit.updated_at is distinct from _expected_updated_at then
    raise exception 'ort_review_changed' using errcode = '40001';
  end if;
  v_old := to_jsonb(v_audit);

  v_status := case
    when _decision = 'reject' then 'rejected'
    when v_audit.fiscal_document_id is not null then 'applied'
    else 'reviewed'
  end;

  update public.ort_extraction_audits
  set reviewed_payload = _reviewed_payload,
      reviewed = true,
      needs_review = false,
      status = v_status,
      reviewed_by = auth.uid(),
      reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = _audit_id and tenant_id = _tenant_id
  returning * into v_audit;

  perform public._log_entity_audit(
    _tenant_id,
    'ort_extraction_audit',
    _audit_id,
    'review_' || _decision,
    v_old,
    to_jsonb(v_audit),
    'review_ort_extraction_v1'
  );

  return jsonb_build_object(
    'id', v_audit.id,
    'tenant_id', v_audit.tenant_id,
    'status', v_audit.status,
    'reviewed', v_audit.reviewed,
    'needs_review', v_audit.needs_review,
    'reviewed_at', v_audit.reviewed_at,
    'updated_at', v_audit.updated_at
  );
end;
$function$;

revoke all on function public.review_ort_extraction_v1(uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.review_ort_extraction_v1(uuid, uuid, text, jsonb, timestamptz) to authenticated, service_role;

comment on function public.review_ort_extraction_v1(uuid, uuid, text, jsonb, timestamptz) is
  'Atomically approves or rejects an ORT extraction review with optimistic concurrency and audit logging.';
