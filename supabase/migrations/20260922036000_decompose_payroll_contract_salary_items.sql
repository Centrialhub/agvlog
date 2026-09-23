do $migration$
declare
  definition text;
  salary_start integer;
  advances_start integer;
  replacement text := $block$    -- 1) Base salary: one auditable item per overlapping contract segment.
    IF _emp.contract_id IS NOT NULL THEN
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'base_salary','credit','Salário base proporcional do contrato',
        round(contract.base_salary *
          ((least(coalesce(contract.end_date,_period_end),_period_end)-greatest(contract.start_date,_period_start)+1)::numeric /
           (_period_end-_period_start+1)::numeric),2),
        'employee_contracts',contract.id,_period_start,_user
      FROM public.employee_contracts contract
      WHERE contract.tenant_id=_tenant_id
        AND contract.employee_id=_emp.employee_id
        AND contract.start_date<=_period_end
        AND (contract.end_date is null or contract.end_date>=_period_start)
        AND contract.base_salary>0
      ORDER BY contract.start_date,contract.id;
    END IF;

$block$;
begin
  select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure)
  into definition;
  salary_start:=position('-- 1) Base salary' in definition);
  advances_start:=position('-- 2) Advances paid within period' in definition);
  if salary_start=0 or advances_start<=salary_start then
    raise exception 'payroll_salary_item_section_not_found' using errcode='55000';
  end if;
  definition:=overlay(definition placing replacement from salary_start-4 for advances_start-(salary_start-4));
  execute definition;
end;
$migration$;

comment on function public.generate_payroll_period(uuid,date,date,text,boolean,boolean) is
  'Generates payroll with one proportional base-salary item per contributing employee contract.';
