create or replace function public.approve_payroll_period_v3(_period_id uuid, _request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_hash text;
  v_stored finance_private.atomic_command_results%rowtype;
  v_result jsonb;
begin
  select tenant_id into v_tenant from public.payroll_periods where id = _period_id;
  if auth.uid() is null or v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if _request_id is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  v_hash := md5(jsonb_build_object('period_id', _period_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':payroll-approve:' || _request_id::text, 0));
  select * into v_stored from finance_private.atomic_command_results
  where tenant_id = v_tenant and action = 'approve_payroll_period' and request_id = _request_id;
  if found then
    if v_stored.payload_hash <> v_hash then raise exception 'request_payload_mismatch' using errcode = '22023'; end if;
    return v_stored.result;
  end if;
  v_result := public.approve_payroll_period_v2(_period_id);
  insert into finance_private.atomic_command_results
  values (v_tenant, 'approve_payroll_period', _request_id, v_hash, v_result, auth.uid(), now());
  return v_result;
end;
$function$;

create or replace function public.close_payroll_period_v2(_period_id uuid, _reason text, _request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_hash text;
  v_stored finance_private.atomic_command_results%rowtype;
  v_result jsonb;
begin
  select tenant_id into v_tenant from public.payroll_periods where id = _period_id;
  if auth.uid() is null or v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if _request_id is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  v_hash := md5(jsonb_build_object('period_id', _period_id, 'reason', coalesce(btrim(_reason), ''))::text);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':payroll-close:' || _request_id::text, 0));
  select * into v_stored from finance_private.atomic_command_results
  where tenant_id = v_tenant and action = 'close_payroll_period' and request_id = _request_id;
  if found then
    if v_stored.payload_hash <> v_hash then raise exception 'request_payload_mismatch' using errcode = '22023'; end if;
    return v_stored.result;
  end if;
  perform public.close_payroll_period(_period_id, _reason);
  v_result := jsonb_build_object('closed', true, 'period_id', _period_id, 'request_id', _request_id);
  insert into finance_private.atomic_command_results
  values (v_tenant, 'close_payroll_period', _request_id, v_hash, v_result, auth.uid(), now());
  return v_result;
end;
$function$;

revoke all on function public.approve_payroll_period_v3(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_payroll_period_v3(uuid, uuid) to authenticated;
revoke all on function public.close_payroll_period_v2(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.close_payroll_period_v2(uuid, text, uuid) to authenticated;
