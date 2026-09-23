-- Reject malformed portal requests at the authoritative RPC boundary.

create or replace function public.create_client_occurrence(
  _tenant_id uuid,
  _client_id uuid,
  _event_type text,
  _description text,
  _severity text default 'medium'::text,
  _load_id uuid default null::uuid,
  _order_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_ok boolean;
begin
  _event_type := btrim(coalesce(_event_type, ''));
  _description := btrim(coalesce(_description, ''));
  _severity := lower(btrim(coalesce(_severity, '')));

  if char_length(_event_type) not between 2 and 80 then
    raise exception using message = 'portal_occurrence_invalid_event_type', errcode = '22023';
  end if;
  if char_length(_description) not between 10 and 2000 then
    raise exception using message = 'portal_occurrence_invalid_description', errcode = '22023';
  end if;
  if _severity not in ('low', 'medium', 'high', 'critical') then
    raise exception using message = 'portal_occurrence_invalid_severity', errcode = '22023';
  end if;

  if not public._portal_user_has_perm(_tenant_id, _client_id, 'can_open_occurrences') then
    raise exception 'Permission denied: cannot open occurrences for this client';
  end if;

  if _load_id is not null then
    select exists(
      select 1 from public.loads l
      where l.id = _load_id and l.tenant_id = _tenant_id
        and (
          exists(select 1 from public.fiscal_documents fd where fd.load_id = l.id and fd.client_id = _client_id)
          or exists(
            select 1 from public.load_items li
            join public.fiscal_documents fd on fd.id = li.fiscal_document_id
            where li.load_id = l.id and fd.client_id = _client_id
          )
          or exists(
            select 1 from public.load_items li
            join public.orders o on o.id = li.order_id
            where li.load_id = l.id and o.client_id = _client_id
          )
        )
    ) into v_ok;
    if not v_ok then raise exception 'access_denied: load does not belong to client/tenant'; end if;
  end if;

  if _order_id is not null then
    select exists(
      select 1 from public.orders o
      where o.id = _order_id and o.tenant_id = _tenant_id and o.client_id = _client_id
    ) into v_ok;
    if not v_ok then raise exception 'access_denied: order does not belong to client/tenant'; end if;
  end if;

  insert into public.operational_events (
    tenant_id, client_id, load_id, order_id, event_type, severity, description,
    visible_to_client, client_opened, public_status, created_by
  ) values (
    _tenant_id, _client_id, _load_id, _order_id, _event_type, _severity, _description,
    true, true, 'reported_by_client', auth.uid()
  ) returning id into v_id;

  perform public._log_entity_audit(_tenant_id, 'operational_event', v_id, 'create_by_client',
    null, jsonb_build_object('client_id', _client_id, 'load_id', _load_id, 'severity', _severity), 'portal');

  return v_id;
end $function$;

create or replace function public.request_client_pickup(
  _tenant_id uuid,
  _client_id uuid,
  _pickup_at timestamptz,
  _recipient_name text default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_id uuid;
  v_num text;
  v_requester_name text;
  v_requester_doc text;
begin
  if _pickup_at is null or _pickup_at <= clock_timestamp() then
    raise exception using message = 'portal_pickup_must_be_future', errcode = '22023';
  end if;

  _recipient_name := nullif(btrim(_recipient_name), '');
  _notes := nullif(btrim(_notes), '');
  if char_length(coalesce(_recipient_name, '')) > 300 then
    raise exception using message = 'portal_pickup_recipient_too_long', errcode = '22023';
  end if;
  if char_length(coalesce(_notes, '')) > 2000 then
    raise exception using message = 'portal_pickup_notes_too_long', errcode = '22023';
  end if;

  if not public._portal_user_has_perm(_tenant_id, _client_id, 'can_request_pickup') then
    raise exception 'Permission denied: cannot request pickup for this client';
  end if;
  select coalesce(c.trade_name, c.company_name, c.legal_name), c.tax_id
    into v_requester_name, v_requester_doc
    from public.clients c where c.id = _client_id and c.tenant_id = _tenant_id;
  if v_requester_name is null then raise exception 'Client not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended('pickup:' || _tenant_id::text, 0));
  select (coalesce(max((regexp_match(pickup_number, '[0-9]+$'))[1]::integer), 0) + 1)::text
    into v_num
    from public.pickup_orders where tenant_id = _tenant_id;

  insert into public.pickup_orders(
    tenant_id, pickup_number, remitter_client_id, remitter_name, remitter_cnpj,
    recipient_name, pickup_at, status, notes, created_by
  ) values (
    _tenant_id, v_num, _client_id, v_requester_name, v_requester_doc,
    _recipient_name, _pickup_at, 'pendente', _notes, auth.uid()
  ) returning id into v_id;

  perform public._log_entity_audit(_tenant_id, 'pickup_order', v_id, 'create_by_client',
    null, jsonb_build_object('client_id', _client_id, 'pickup_at', _pickup_at), 'portal');
  return v_id;
end $function$;
