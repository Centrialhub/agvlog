import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('durable command recovery in production flows', () => {
  it.each([
    ['src/hooks/usePickupOrders.tsx', 'create_pickup_order'],
    ['src/hooks/useFleetManagement.tsx', 'create_vehicle_fueling'],
    ['src/hooks/useOccurrenceReports.tsx', 'import_occurrence_report'],
    ['src/hooks/usePayroll.tsx', 'create_employee_contract'],
  ])('%s preserves only uncertain outcomes and exposes recovery for %s', (path, action) => {
    const source = read(path);
    expect(source).toContain(action);
    expect(source).toContain('isDefinitiveOperatorCommandRejection');
    expect(source).toContain('readDurableOperatorCommand');
    expect(source).toContain('recoverPending');
    expect(source).toContain('discardPending');
  });

  it('offers recover and discard actions for a payroll period transition', () => {
    const hook = read('src/hooks/usePayroll.tsx');
    const screen = read('src/components/financial/payroll/PayrollPeriodEntries.tsx');
    expect(hook).toContain('getPendingCommand');
    expect(hook).toContain('entityId:periodId');
    expect(screen).toContain('pendingLifecycle');
    expect(screen).toContain('PendingCommandRecovery');
  });
});
