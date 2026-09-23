import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAdministerVehicle } from '@/lib/fleet/vehiclePermissions';

describe('permissões de POI na ficha do veículo', () => {
  it('oferece comandos administrativos apenas a owner e admin', () => {
    expect(canAdministerVehicle('owner')).toBe(true);
    expect(canAdministerVehicle('admin')).toBe(true);
    expect(canAdministerVehicle('operator')).toBe(false);
    expect(canAdministerVehicle('driver')).toBe(false);
    expect(canAdministerVehicle(null)).toBe(false);
  });

  it('protege botão, diálogo e mutações com a mesma decisão', () => {
    const source = readFileSync('src/pages/VehicleDetails.tsx', 'utf8');
    expect(source).toContain('{canManagePois && <Button aria-label="Gerenciar POI da parada"');
    expect(source).toContain('{canManagePois && <Dialog');
    expect(source.match(/if \(!canManagePois\) throw new Error/g)).toHaveLength(2);
  });
});
