import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAdministerVehicle } from '@/lib/fleet/vehiclePermissions';

describe('permissão de abastecimento na ficha do veículo', () => {
  it('não apresenta o comando de escrita a operadores', () => {
    expect(canAdministerVehicle('operator')).toBe(false);
    expect(canAdministerVehicle('admin')).toBe(true);
    const source = readFileSync('src/components/fleet/FuelingTab.tsx', 'utf8');
    expect(source).toContain('canCreateFueling ? <Button');
    expect(source).toContain('{canCreateFueling && <Dialog');
    expect(source).toContain('if (!canCreateFueling)');
  });
});
