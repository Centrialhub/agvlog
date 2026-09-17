-- Historical rows are clean; make the tenant-qualified integrity guarantees
-- apply to the whole table instead of only to writes made after the FK rollout.
alter table public.checklist_executions
  validate constraint checklist_executions_tenant_checklist_fkey;

alter table public.checklist_executions
  validate constraint checklist_executions_tenant_vehicle_fkey;

alter table public.checklist_executions
  validate constraint checklist_executions_tenant_employee_fkey;

alter table public.checklist_executions
  validate constraint checklist_executions_tenant_trip_fkey;

alter table public.checklist_executions
  validate constraint checklist_executions_tenant_incident_fkey;

alter table public.checklist_executions
  validate constraint checklist_executions_tenant_maintenance_fkey;
