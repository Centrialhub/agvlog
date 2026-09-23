do $patch$
declare
  body text;
  old_guard text := $guard$  if exists(select 1 from public.payroll_generation_issues where payroll_period_id=_period_id and not resolved) then
    raise exception 'finance_payroll_unresolved_generation_issues' using errcode='23514';
  end if;$guard$;
  new_guard text := $guard$  if exists(select 1 from public.payroll_generation_issues where payroll_period_id=_period_id and not resolved) then
    -- Return normally so diagnostics inserted earlier in this transaction remain durable.
    return;
  end if;$guard$;
begin
  select pg_get_functiondef('public.approve_payroll_period(uuid)'::regprocedure) into body;
  if position(old_guard in body) = 0 then
    raise exception 'finance_payroll_approval_issue_guard_changed';
  end if;
  execute replace(body, old_guard, new_guard);
end;
$patch$;

create or replace function public.approve_payroll_period_v2(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p public.payroll_periods%rowtype;
  issue_count integer;
begin
  select * into p from public.payroll_periods where id = _period_id;
  if p.id is null or auth.uid() is null or not public.is_tenant_operator_or_admin(p.tenant_id) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  perform public.approve_payroll_period(_period_id);
  select count(*)::integer into issue_count
  from public.payroll_generation_issues
  where tenant_id = p.tenant_id and payroll_period_id = p.id and not resolved;
  select * into p from public.payroll_periods where id = _period_id;
  return jsonb_build_object(
    'version', 2,
    'period_id', p.id,
    'tenant_id', p.tenant_id,
    'approved', p.status = 'approved',
    'issue_count', issue_count
  );
end;
$function$;

revoke all on function public.approve_payroll_period_v2(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_payroll_period_v2(uuid) to authenticated;

comment on function public.approve_payroll_period_v2(uuid) is
  'Approves a payroll period or commits blocking generation issues and returns approved=false.';
