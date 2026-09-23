create or replace function public.create_client_occurrence_v3(
  _tenant_id uuid,
  _client_id uuid,
  _event_type text,
  _description text,
  _request_id uuid,
  _severity text default 'medium'::text,
  _load_id uuid default null::uuid,
  _order_id uuid default null::uuid,
  _fiscal_document_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_existing public.operational_events%rowtype;
  v_document_client_id uuid;
  v_document_load_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;
  if _request_id is null then
    raise exception using message = 'portal_occurrence_request_id_required', errcode = '22023';
  end if;

  _event_type := btrim(coalesce(_event_type, ''));
  _description := btrim(coalesce(_description, ''));
  _severity := lower(btrim(coalesce(_severity, '')));
  v_key := 'portal-occurrence:' || auth.uid()::text || ':' || _request_id::text;

  if _fiscal_document_id is not null then
    select fd.client_id, fd.load_id
      into v_document_client_id, v_document_load_id
    from public.fiscal_documents fd
    where fd.id = _fiscal_document_id
      and fd.tenant_id = _tenant_id
      and fd.deleted_at is null;
    if not found or v_document_client_id is distinct from _client_id then
      raise exception using message = 'access_denied: fiscal document does not belong to client/tenant', errcode = '42501';
    end if;
    if _load_id is not null and _load_id is distinct from v_document_load_id then
      raise exception using message = 'portal_occurrence_document_load_mismatch', errcode = '22023';
    end if;
    _load_id := coalesce(_load_id, v_document_load_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text || ':' || v_key, 0));
  select * into v_existing
  from public.operational_events
  where tenant_id = _tenant_id and idempotency_key = v_key;

  if found then
    if v_existing.client_id is distinct from _client_id
       or v_existing.load_id is distinct from _load_id
       or v_existing.order_id is distinct from _order_id
       or v_existing.fiscal_document_id is distinct from _fiscal_document_id
       or v_existing.event_type is distinct from _event_type
       or v_existing.description is distinct from _description
       or v_existing.severity is distinct from _severity
       or v_existing.created_by is distinct from auth.uid() then
      raise exception using message = 'portal_occurrence_request_id_mismatch', errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  v_id := public.create_client_occurrence(
    _tenant_id, _client_id, _event_type, _description, _severity, _load_id, _order_id
  );
  update public.operational_events
  set idempotency_key = v_key,
      fiscal_document_id = _fiscal_document_id
  where id = v_id and tenant_id = _tenant_id;
  return v_id;
end $function$;

revoke all on function public.create_client_occurrence_v3(uuid, uuid, text, text, uuid, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.create_client_occurrence_v3(uuid, uuid, text, text, uuid, text, uuid, uuid, uuid)
  to authenticated, service_role;

do $migration$
declare
  v_function text;
  v_old text := '''id'', _fd.id, ''invoice_number'', _fd.invoice_number';
  v_new text := '''id'', _fd.id, ''client_id'', _fd.client_id, ''invoice_number'', _fd.invoice_number';
begin
  select pg_get_functiondef('public.get_client_portal_shipment_detail_v2(uuid)'::regprocedure)
  into v_function;
  if position(v_old in v_function) = 0 then
    raise exception 'portal_shipment_detail_document_identity_contract_not_found';
  end if;
  execute replace(v_function, v_old, v_new);
end;
$migration$;
