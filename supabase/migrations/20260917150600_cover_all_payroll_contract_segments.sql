create or replace function finance_private.payroll_employee_in_scope_v1(
  _tenant_id uuid,
  _employee_id uuid,
  _period_start date,
  _period_end date,
  _include_drivers boolean,
  _include_non_drivers boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.employees employee
    where employee.tenant_id = _tenant_id
      and employee.id = _employee_id
      and (
        (_include_drivers and employee.driver_id is not null)
        or (_include_non_drivers and employee.driver_id is null)
      )
      and (employee.hire_date is null or employee.hire_date <= _period_end)
      and (employee.termination_date is null or employee.termination_date >= _period_start)
      and (
        employee.status is null
        or employee.status in ('active','on_leave')
        or employee.termination_date between _period_start and _period_end
        or exists (
          select 1
          from public.employee_contracts contract
          where contract.tenant_id = _tenant_id
            and contract.employee_id = employee.id
            and contract.start_date <= _period_end
            and (contract.end_date is null or contract.end_date >= _period_start)
        )
      )
  );
$function$;

revoke all on function finance_private.payroll_employee_in_scope_v1(uuid,uuid,date,date,boolean,boolean)
from public, anon, authenticated, service_role;

do $patch_generator$
declare
  definition text;
  changed text;
begin
  select pg_get_functiondef(
    'public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure
  ) into definition;

  changed := replace(
    definition,
    $old$and (e.status is null or e.status in('active','on_leave'))$old$,
    $new$and finance_private.payroll_employee_in_scope_v1(
        _tenant_id,e.id,_period_start,_period_end,_include_drivers,_include_non_drivers)$new$
  );
  if changed = definition then
    raise exception 'payroll_cleanup_scope_contract_changed';
  end if;
  definition := changed;

  changed := replace(
    definition,
    $old$AND (e.status IS NULL OR e.status IN ('active','on_leave'))$old$,
    $new$AND finance_private.payroll_employee_in_scope_v1(
        _tenant_id,e.id,_period_start,_period_end,_include_drivers,_include_non_drivers)$new$
  );
  if changed = definition then
    raise exception 'payroll_generation_scope_contract_changed';
  end if;
  definition := changed;

  changed := replace(
    definition,
    $old$IF _emp.contract_id IS NOT NULL AND COALESCE(_emp.base_salary,0) > 0 THEN$old$,
    $new$IF _emp.contract_id IS NOT NULL THEN$new$
  );
  if changed = definition then
    raise exception 'payroll_salary_condition_contract_changed';
  end if;
  definition := changed;

  changed := replace(
    definition,
    $old$'base_salary','credit','Salário base proporcional do contrato', round(_emp.base_salary *
          ((least(coalesce(_emp.contract_end,_period_end),_period_end)-greatest(_emp.contract_start,_period_start)+1)::numeric /
           (_period_end-_period_start+1)::numeric),2),$old$,
    $new$'base_salary','credit','Salário base proporcional dos contratos', coalesce((
          select sum(round(contract.base_salary *
            ((least(coalesce(contract.end_date,_period_end),_period_end)-greatest(contract.start_date,_period_start)+1)::numeric /
             (_period_end-_period_start+1)::numeric),2))
          from public.employee_contracts contract
          where contract.tenant_id=_tenant_id
            and contract.employee_id=_emp.employee_id
            and contract.start_date<=_period_end
            and (contract.end_date is null or contract.end_date>=_period_start)
            and contract.base_salary>0
        ),0),$new$
  );
  if changed = definition then
    raise exception 'payroll_salary_proration_contract_changed';
  end if;

  execute changed;
end
$patch_generator$;
