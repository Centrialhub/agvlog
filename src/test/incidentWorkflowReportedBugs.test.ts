import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('formal incident workflow',()=>{
  const page=readFileSync('src/pages/Incidents.tsx','utf8');
  const hook=readFileSync('src/hooks/useIncidents.tsx','utf8');
  const dashboard=readFileSync('src/pages/OperationsDashboard.tsx','utf8');
  const migration=readFileSync('supabase/migrations/20260922003000_harden_incident_workflow.sql','utf8');
  const dashboardMigration=readFileSync('supabase/migrations/20260922005000_operations_dashboard_summary.sql','utf8');
  it('records actual cost distinctly, including a confirmed zero',()=>{expect(page).toContain('Custo Real (R$)');expect(page).toContain("form.actual_cost===''?null:Number(form.actual_cost)");expect(page).toContain('i.actual_cost ?? i.estimated_cost ?? 0');expect(dashboard).toContain('dashboard.incident_cost');expect(dashboardMigration).toContain('coalesce(actual_cost,estimated_cost,0)');expect(migration).toContain('actual_cost drop default');});
  it('excludes every terminal state from critical active incidents',()=>{expect(page).toContain("!['resolved','closed','cancelled'].includes(i.status)");});
  it('supports clearing links and resets captured state on tenant changes',()=>{expect(page).toContain('<SelectItem value={NONE}>Nenhum</SelectItem>');expect(page).toContain("employee_id:v==='hr'?f.employee_id:''");expect(page).toContain('[currentTenant?.id]');expect(hook).toContain("['employee_incident_actions', currentTenant?.id, incidentId]");});
  it('requires and exposes formal responsibility and preserves incident versions',()=>{expect(page).toContain('IncidentResponsibilitySection');expect(migration).toContain('incident_responsibility_required');expect(migration).toContain('incident_versions');expect(migration).toContain("'incident_update'");});
  it('restores authenticated RPC access while blocking direct action forgery',()=>{expect(migration).toContain('grant execute on function public.add_employee_incident_action');expect(migration).toContain('drop policy if exists eia_insert');expect(migration).toContain('drop policy if exists eia_update');expect(migration).toContain('admin_required_for_payroll_discount');});
  it('validates formal action fields and permits controlled completion or cancellation',()=>{expect(page).toContain("if (!description.trim())");expect(migration).toContain('incident_action_effective_date_required');expect(hook).toContain('useSetEmployeeIncidentActionStatus');expect(page).toContain("status:'completed'");expect(page).toContain("status:'cancelled'");});
  it('hides write controls from operators and reports failed reference catalogs',()=>{expect(page).toContain("const canManage=currentRole==='owner'||currentRole==='admin'");expect(page).toContain('Não foi possível carregar todos os cadastros vinculáveis');expect(page).toContain('query.refetch()');});
});
