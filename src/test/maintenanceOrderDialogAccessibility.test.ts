import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/MaintenanceOrders.tsx', 'utf8');

describe('maintenance order dialog accessibility', () => {
  it('describes the maintenance order form for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Registre o veículo, o problema relatado, custos e detalhes da ordem de manutenção.');
  });
});
