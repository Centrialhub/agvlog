alter table public.pickup_orders
  add column if not exists portal_cancel_request_id uuid,
  add column if not exists portal_cancelled_by uuid,
  add column if not exists portal_cancellation_reason text,
  add column if not exists portal_cancelled_at timestamptz;

create unique index if not exists pickup_orders_portal_cancel_request_uidx
  on public.pickup_orders (tenant_id, portal_cancel_request_id)
  where portal_cancel_request_id is not null;

create or replace function public.cancel_client_pickup_v2(
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

revoke all on function public.cancel_client_pickup_v2(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.cancel_client_pickup_v2(uuid, uuid, text, uuid) to authenticated, service_role;
