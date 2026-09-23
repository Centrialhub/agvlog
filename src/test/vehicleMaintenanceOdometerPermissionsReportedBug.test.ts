import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('permissões de manutenção e odômetro na ficha do veículo', () => {
  it('mantém históricos visíveis e protege todos os comandos administrativos', () => {
    const maintenance = readFileSync('src/components/fleet/MaintenanceTab.tsx', 'utf8');
    const odometer = readFileSync('src/components/fleet/OdometerTab.tsx', 'utf8');
    expect(maintenance).toContain('canManageMaintenance ? <Button');
    expect(maintenance).toContain('canManageMaintenance && m.status');
    expect(maintenance).toContain('{canManageMaintenance && <Dialog');
    expect(maintenance.match(/if \(!canManageMaintenance\)/g)).toHaveLength(2);
    expect(odometer).toContain('canCreateReading ? <Button');
    expect(odometer).toContain('{canCreateReading && <Dialog');
    expect(odometer).toContain('if (!canCreateReading)');
  });
});
