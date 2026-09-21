import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/MaintenanceOrders.tsx', 'utf8');

describe('maintenance order form state', () => {
  it('keeps save disabled while required fields or numeric values are invalid', () => {
    expect(source).toContain('maintenanceOrderRequiredFieldsError(form.vehicle_id, form.reported_problem)');
    expect(source).toContain('const formInvalid =');
    expect(source).toContain('Number(value) < 0');
    expect(source).toContain('updateOrder.isPending || formInvalid');
  });
});
