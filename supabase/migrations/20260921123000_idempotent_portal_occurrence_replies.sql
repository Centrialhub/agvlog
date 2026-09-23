alter table public.client_occurrence_messages
  add column if not exists request_id uuid;

create unique index if not exists client_occurrence_messages_request_uidx
  on public.client_occurrence_messages (tenant_id, request_id)
  where request_id is not null;

create or replace function public.reply_client_occurrence_v2(
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

revoke all on function public.reply_client_occurrence_v2(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.reply_client_occurrence_v2(uuid, uuid, text, uuid) to authenticated, service_role;
