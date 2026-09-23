create or replace function public.detach_load_from_driver_settlement(
  _settlement_id uuid,
  _load_id uuid
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_s public.driver_settlements;
  v_deleted integer;
begin
  select * into v_s
  from public.driver_settlements
  where id = _settlement_id
  for update;

  if not found then
    raise exception 'settlement_not_found';
  end if;

  if not public.is_tenant_operator_or_admin(v_s.tenant_id) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if not v_s.is_manual then
    raise exception 'not_manual_settlement';
  end if;

  if v_s.status not in ('pending_review', 'in_review', 'reopened') then
    raise exception 'settlement_locked';
  end if;

  delete from public.driver_settlement_loads
  where settlement_id = _settlement_id
    and load_id = _load_id
    and tenant_id = v_s.tenant_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'settlement_load_not_found' using errcode = '22023';
  end if;

  perform public._log_settlement_event(
    _settlement_id,
    'load_detached',
    null,
    null,
    null,
    jsonb_build_object('load_id', _load_id)
  );

  perform public._build_manual_driver_settlement(_settlement_id);
end;
$function$;

revoke all on function public.detach_load_from_driver_settlement(uuid,uuid) from public,anon;
grant execute on function public.detach_load_from_driver_settlement(uuid,uuid) to authenticated,service_role;
