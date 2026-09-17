create or replace function public.clear_ssx_account_cooldown_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _observed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account public.integration_accounts%rowtype;
  v_cleared boolean := false;
begin
  if _tenant_id is null or _integration_account_id is null
     or _observed_at is null or not isfinite(_observed_at)
     or _observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'ssx_account_recovery_identity_invalid';
  end if;

  select * into v_account
  from public.integration_accounts
  where id = _integration_account_id
    and tenant_id = _tenant_id
    and lower(provider) = 'ssx'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ssx_account_invalid';
  end if;

  -- A stale successful poll must never erase a newer rate-limit observation.
  if coalesce(v_account.updated_at, '-infinity'::timestamptz) <= _observed_at then
    update public.integration_accounts
       set poll_cooldown_until = null,
           last_error = null,
           updated_at = _observed_at
     where id = _integration_account_id
       and tenant_id = _tenant_id;
    v_cleared := true;
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'integration_account_id', _integration_account_id,
    'observed_at', _observed_at,
    'cleared', v_cleared
  );
end;
$function$;

revoke all on function public.clear_ssx_account_cooldown_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.clear_ssx_account_cooldown_v1(uuid, uuid, timestamptz)
  to service_role;

comment on function public.clear_ssx_account_cooldown_v1(uuid, uuid, timestamptz)
  is 'Service-only monotonic SSX account recovery. A successful poll cannot erase a newer cooldown.';
