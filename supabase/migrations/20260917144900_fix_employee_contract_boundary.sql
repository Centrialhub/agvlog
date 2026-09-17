-- Contract dates are inclusive throughout payroll. Close the previous active
-- contract on the day before its replacement starts.
with ordered_contracts as (
  select
    id,
    start_date,
    end_date,
    lead(start_date) over (
      partition by tenant_id, employee_id
      order by start_date, created_at, id
    ) as next_start_date
  from public.employee_contracts
)
update public.employee_contracts contract
set end_date = ordered.next_start_date - 1,
    updated_at = now()
from ordered_contracts ordered
where contract.id = ordered.id
  and ordered.next_start_date > ordered.start_date
  and ordered.end_date = ordered.next_start_date;

create or replace function finance_private.create_employee_contract_unsafe_20260917(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $fn$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id', '')::uuid;
  v_employee uuid := nullif(_payload->>'employee_id', '')::uuid;
  v_start date := (_payload->>'start_date')::date;
  v_active boolean := coalesce((_payload->>'active')::boolean, true);
  v_row public.employee_contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('employee-contract:' || v_employee::text, 0));

  if v_active then
    if exists (
      select 1
      from public.employee_contracts
      where tenant_id = v_tenant
        and employee_id = v_employee
        and active
        and start_date >= v_start
    ) then
      raise exception 'contract_start_must_follow_active_contract' using errcode = '22023';
    end if;

    update public.employee_contracts
    set active = false,
        end_date = v_start - 1,
        updated_at = now(),
        updated_by = auth.uid()
    where tenant_id = v_tenant
      and employee_id = v_employee
      and active;
  end if;

  insert into public.employee_contracts(
    tenant_id, employee_id, contract_type, employment_regime, start_date, end_date,
    active, position_title, department, branch, cost_center, base_salary, hourly_rate,
    daily_rate, commission_rate, payment_cycle, payment_method, bank_info, notes, created_by
  ) values (
    v_tenant, v_employee, coalesce(nullif(_payload->>'contract_type', ''), 'employee'),
    nullif(_payload->>'employment_regime', ''), v_start, nullif(_payload->>'end_date', '')::date,
    v_active, nullif(_payload->>'position_title', ''), nullif(_payload->>'department', ''),
    nullif(_payload->>'branch', ''), nullif(_payload->>'cost_center', ''),
    coalesce(nullif(_payload->>'base_salary', '')::numeric, 0),
    coalesce(nullif(_payload->>'hourly_rate', '')::numeric, 0),
    coalesce(nullif(_payload->>'daily_rate', '')::numeric, 0),
    coalesce(nullif(_payload->>'commission_rate', '')::numeric, 0),
    coalesce(nullif(_payload->>'payment_cycle', ''), 'monthly'),
    nullif(_payload->>'payment_method', ''), coalesce(_payload->'bank_info', '{}'::jsonb),
    nullif(_payload->>'notes', ''), auth.uid()
  ) returning * into v_row;

  return to_jsonb(v_row);
end;
$fn$;

revoke all on function finance_private.create_employee_contract_unsafe_20260917(jsonb)
  from public, anon, authenticated, service_role;
