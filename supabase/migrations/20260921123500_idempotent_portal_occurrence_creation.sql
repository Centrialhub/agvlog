create or replace function public.create_client_occurrence_v2(
  _tenant_id uuid,
  _client_id uuid,
  _event_type text,
  _description text,
  _severity text default 'medium'::text,
  _load_id uuid default null::uuid,
  _order_id uuid default null::uuid,
  _request_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_existing public.operational_events%rowtype;
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

  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text || ':' || v_key, 0));
  select * into v_existing
  from public.operational_events
  where tenant_id = _tenant_id and idempotency_key = v_key;

  if found then
    if v_existing.client_id is distinct from _client_id
       or v_existing.load_id is distinct from _load_id
       or v_existing.order_id is distinct from _order_id
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
  set idempotency_key = v_key
  where id = v_id and tenant_id = _tenant_id;
  return v_id;
end $function$;

revoke all on function public.create_client_occurrence_v2(uuid, uuid, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.create_client_occurrence_v2(uuid, uuid, text, text, text, uuid, uuid, uuid) to authenticated, service_role;
