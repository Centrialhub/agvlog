-- Restore published Portal commands that are absent from the live database.
-- Keep an existing implementation intact and install each missing signature with
-- its original privileges. The prerequisite schema changes are idempotent.
do $restore$
begin
  if to_regclass('public.operational_events') is null
    or to_regclass('public.client_occurrence_messages') is null
    or to_regclass('public.pickup_orders') is null
    or to_regclass('public.fiscal_documents') is null
    or to_regprocedure('public.create_client_occurrence(uuid,uuid,text,text,text,uuid,uuid)') is null
    or to_regprocedure('public._portal_user_client_ids(uuid)') is null
    or to_regprocedure('public._portal_user_has_perm(uuid,uuid,text)') is null
    or to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)') is null
    or to_regprocedure('auth.uid()') is null then
    raise exception 'portal_occurrence_command_dependency_missing';
  end if;
  if not exists (select 1 from pg_index i
      where i.indrelid = 'public.operational_events'::regclass and i.indisunique
        and position('(tenant_id, idempotency_key)' in pg_get_indexdef(i.indexrelid)) > 0) then
    raise exception 'portal_occurrence_idempotency_index_missing';
  end if;
end;
$restore$;

alter table public.client_occurrence_messages add column if not exists request_id uuid;
create unique index if not exists client_occurrence_messages_request_uidx
  on public.client_occurrence_messages (tenant_id, request_id)
  where request_id is not null;

alter table public.pickup_orders
  add column if not exists portal_cancel_request_id uuid,
  add column if not exists portal_cancelled_by uuid,
  add column if not exists portal_cancellation_reason text,
  add column if not exists portal_cancelled_at timestamptz;
create unique index if not exists pickup_orders_portal_cancel_request_uidx
  on public.pickup_orders (tenant_id, portal_cancel_request_id)
  where portal_cancel_request_id is not null;

do $restore$
begin
  if to_regprocedure('public.create_client_occurrence_v3(uuid,uuid,text,text,uuid,text,uuid,uuid,uuid)') is null then
    execute $definition$
create function public.create_client_occurrence_v3(
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
$definition$;
    revoke all on function public.create_client_occurrence_v3(uuid,uuid,text,text,uuid,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
    grant execute on function public.create_client_occurrence_v3(uuid,uuid,text,text,uuid,text,uuid,uuid,uuid) to authenticated, service_role;
  end if;
end;
$restore$;

do $restore$
begin
  if to_regprocedure('public.reply_client_occurrence_v2(uuid,uuid,text,uuid)') is null then
    execute $definition$
create function public.reply_client_occurrence_v2(
  _tenant_id uuid,
  _occurrence_id uuid,
  _message text,
  _request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
  v_resolved_at timestamptz;
  v_id uuid;
  v_existing public.client_occurrence_messages%rowtype;
begin
  _message := btrim(coalesce(_message, ''));
  if char_length(_message) not between 1 and 4000 then
    raise exception using message = 'portal_occurrence_message_invalid', errcode = '22023';
  end if;
  if _request_id is null then
    raise exception using message = 'portal_occurrence_request_id_required', errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;

  select client_id, resolved_at into v_client, v_resolved_at
  from public.operational_events
  where id = _occurrence_id and tenant_id = _tenant_id and visible_to_client = true
  for update;
  if v_client is null then raise exception 'Occurrence not found'; end if;
  if not (v_client = any(public._portal_user_client_ids(_tenant_id))) then
    raise exception 'Permission denied';
  end if;
  if v_resolved_at is not null then
    raise exception using message = 'portal_occurrence_already_resolved', errcode = '22023';
  end if;

  insert into public.client_occurrence_messages (
    tenant_id, occurrence_id, author_user_id, author_role, message, request_id
  ) values (
    _tenant_id, _occurrence_id, auth.uid(), 'client', _message, _request_id
  )
  on conflict (tenant_id, request_id) where request_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing
    from public.client_occurrence_messages
    where tenant_id = _tenant_id and request_id = _request_id;
    if v_existing.occurrence_id <> _occurrence_id
       or v_existing.author_user_id is distinct from auth.uid()
       or v_existing.author_role <> 'client'
       or v_existing.message <> _message then
      raise exception using message = 'portal_occurrence_request_id_mismatch', errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  update public.operational_events
  set client_opened = true, updated_at = now()
  where id = _occurrence_id;

  return v_id;
end $function$;
$definition$;
    revoke all on function public.reply_client_occurrence_v2(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
    grant execute on function public.reply_client_occurrence_v2(uuid,uuid,text,uuid) to authenticated, service_role;
  end if;
end;
$restore$;

do $restore$
begin
  if to_regprocedure('public.cancel_client_pickup_v2(uuid,uuid,text,uuid)') is null then
    execute $definition$
create function public.cancel_client_pickup_v2(
  _tenant_id uuid,
  _pickup_id uuid,
  _reason text,
  _request_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
  v_status text;
  v_saved_request_id uuid;
  v_saved_reason text;
  v_cancelled_by uuid;
begin
  _reason := btrim(coalesce(_reason, ''));
  if char_length(_reason) not between 10 and 500 then
    raise exception using message = 'portal_pickup_cancellation_reason_invalid', errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;
  if _request_id is null then
    raise exception using message = 'portal_pickup_cancel_request_id_required', errcode = '22023';
  end if;

  select remitter_client_id, status, portal_cancel_request_id, portal_cancellation_reason, portal_cancelled_by
  into v_client, v_status, v_saved_request_id, v_saved_reason, v_cancelled_by
  from public.pickup_orders
  where id = _pickup_id and tenant_id = _tenant_id
  for update;

  if v_client is null then raise exception 'Pickup not found'; end if;
  if not public._portal_user_has_perm(_tenant_id, v_client, 'can_request_pickup') then
    raise exception 'Permission denied';
  end if;
  if v_status = 'cancelada'
     and v_saved_request_id = _request_id
     and v_saved_reason = _reason
     and v_cancelled_by = auth.uid() then
    return;
  end if;
  if v_status <> 'pendente' then
    raise exception 'Only pending pickups can be cancelled';
  end if;

  update public.pickup_orders
  set status = 'cancelada',
      portal_cancel_request_id = _request_id,
      portal_cancelled_by = auth.uid(),
      portal_cancellation_reason = _reason,
      portal_cancelled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = _pickup_id;

  perform public._log_entity_audit(
    _tenant_id,
    'pickup_order',
    _pickup_id,
    'cancel_by_client',
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'cancelada', 'reason', _reason, 'actor_id', auth.uid()),
    'portal'
  );
end $function$;
$definition$;
    revoke all on function public.cancel_client_pickup_v2(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
    grant execute on function public.cancel_client_pickup_v2(uuid,uuid,text,uuid) to authenticated, service_role;
  end if;
end;
$restore$;
