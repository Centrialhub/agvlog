-- Keep personnel records available to the operators who manage incidents,
-- while ordinary members can read only records assigned to their own account.
drop policy if exists "Members can view incident_responsible"
  on public.incident_responsible;
drop policy if exists agvlog_select_authenticated
  on public.incident_responsible;
drop policy if exists "Assigned employees and operators can view incident_responsible"
  on public.incident_responsible;
-- The published schema predates assigned_user_id. Its later acknowledgement
-- migration adds that snapshot, so support both schemas without broadening
-- access when the account binding changes.
do $policy$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'incident_responsible'
      and column_name = 'assigned_user_id'
  ) then
    execute $sql$
      create policy "Assigned employees and operators can view incident_responsible"
        on public.incident_responsible for select to authenticated
        using (
          public.is_tenant_operator_or_admin(tenant_id)
          or (
            assigned_user_id = (select auth.uid())
            and public.is_tenant_member(tenant_id)
            and exists (
              select 1 from public.employees employee
              where employee.id = incident_responsible.employee_id
                and employee.tenant_id = incident_responsible.tenant_id
                and employee.user_id = (select auth.uid())
            )
          )
        )
    $sql$;
  else
    execute $sql$
      create policy "Assigned employees and operators can view incident_responsible"
        on public.incident_responsible for select to authenticated
        using (
          public.is_tenant_operator_or_admin(tenant_id)
          or (
            public.is_tenant_member(tenant_id)
            and exists (
              select 1 from public.employees employee
              where employee.id = incident_responsible.employee_id
                and employee.tenant_id = incident_responsible.tenant_id
                and employee.user_id = (select auth.uid())
            )
          )
        )
    $sql$;
  end if;
end;
$policy$;

drop policy if exists eia_select on public.employee_incident_actions;
drop policy if exists agvlog_select_authenticated
  on public.employee_incident_actions;
create policy eia_select on public.employee_incident_actions
  for select to authenticated
  using (
    public.is_tenant_operator_or_admin(tenant_id)
    or (
      public.is_tenant_member(tenant_id)
      and exists (
        select 1 from public.employees employee
        where employee.id = employee_incident_actions.employee_id
          and employee.tenant_id = employee_incident_actions.tenant_id
          and employee.user_id = (select auth.uid())
      )
    )
  );
