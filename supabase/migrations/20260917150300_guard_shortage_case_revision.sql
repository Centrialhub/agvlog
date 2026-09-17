create or replace function public.update_merchandise_shortage_status(
  _case_id uuid,
  _status text,
  _payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_case public.merchandise_shortage_cases%rowtype;
  v_expected_updated_at timestamptz;
begin
  if coalesce(jsonb_typeof(_payload), '') <> 'object'
     or nullif(_payload->>'expected_updated_at', '') is null then
    raise exception 'shortage_case_revision_required' using errcode = '22023';
  end if;

  begin
    v_expected_updated_at := (_payload->>'expected_updated_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'shortage_case_revision_invalid' using errcode = '22023';
  end;

  select shortage.tenant_id
  into v_tenant_id
  from public.merchandise_shortage_cases shortage
  where shortage.id = _case_id;

  if v_tenant_id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.is_tenant_operator_or_admin(v_tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_case
  from public.merchandise_shortage_cases shortage
  where shortage.id = _case_id
  for update;

  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_case.tenant_id is distinct from v_tenant_id
     or not public.is_tenant_operator_or_admin(v_case.tenant_id) then
    raise exception 'shortage_case_revision_changed' using errcode = '40001';
  end if;
  if v_case.updated_at is distinct from v_expected_updated_at then
    raise exception 'shortage_case_revision_changed' using errcode = '40001';
  end if;

  perform finance_private.assert_tenant_reference(
    'public.drivers',
    v_case.tenant_id,
    nullif(_payload->>'responsible_driver_id', '')::uuid,
    'responsible_driver'
  );
  perform finance_private.assert_tenant_reference(
    'public.clients',
    v_case.tenant_id,
    nullif(_payload->>'responsible_client_id', '')::uuid,
    'responsible_client'
  );
  perform finance_private.assert_tenant_reference(
    'public.clients',
    v_case.tenant_id,
    nullif(_payload->>'responsible_supplier_id', '')::uuid,
    'responsible_supplier'
  );

  perform finance_private.update_merchandise_shortage_status_unsafe_20260917(
    _case_id,
    _status,
    _payload
  );
end;
$function$;

revoke all on function public.update_merchandise_shortage_status(uuid,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.update_merchandise_shortage_status(uuid,text,jsonb)
to authenticated, service_role;
