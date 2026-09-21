import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync('src/hooks/useOperationalChecklists.tsx', 'utf8');
const page = readFileSync('src/pages/Checklists.tsx', 'utf8');

describe('reported checklist relationship ambiguity', () => {
  it('selects the tenant-safe relationships explicitly', () => {
    expect(hook).toContain('operational_checklists!checklist_executions_tenant_checklist_fkey');
    expect(hook).toContain('vehicles!checklist_executions_tenant_vehicle_fkey');
    expect(hook).toContain('employees!checklist_executions_tenant_employee_fkey');
  });

  it('surfaces structured PostgREST errors instead of replacing them with a generic message', () => {
    expect(page).toContain("import { getErrorMessage } from '@/lib/errors'");
    expect(page).toContain("getErrorMessage(sourceError, 'Falha na consulta dos dados necessários.')");
  });
});
