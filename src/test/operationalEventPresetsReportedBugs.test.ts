import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  legacyOperationalEventPresetsKey,
  loadOperationalEventPresets,
  operationalEventPresetsKey,
  parseOperationalEventPresets,
} from '@/lib/operationalEvents/presets';

describe('presets de ocorrências operacionais', () => {
  it('rejeita JSON válido com formato incompatível', () => {
    expect(parseOperationalEventPresets('{}')).toBeNull();
    expect(parseOperationalEventPresets('[{"id":"x"}]')).toBeNull();
    expect(parseOperationalEventPresets(null)).toEqual([]);
  });

  it('isola a chave por usuário e tenant', () => {
    expect(operationalEventPresetsKey('user-1', 'tenant-a')).toBe('opEvents.presets.v2.user-1.tenant-a');
    expect(operationalEventPresetsKey('user-1', 'tenant-b')).not.toBe(operationalEventPresetsKey('user-1', 'tenant-a'));
    expect(operationalEventPresetsKey('user-1')).toBeNull();
  });

  it('migra uma única vez os presets globais v1 para o tenant atual', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const legacyKey = legacyOperationalEventPresetsKey('user-1')!;
    const currentKey = operationalEventPresetsKey('user-1', 'tenant-a')!;
    values.set(legacyKey, '[{"id":"custom:1","name":"Meu filtro","filters":{"status":"open"}}]');

    expect(loadOperationalEventPresets(storage, 'user-1', 'tenant-a')).toEqual({
      presets: [{ id: 'custom:1', name: 'Meu filtro', filters: { status: 'open' } }],
      migratedFromLegacy: true,
    });
    expect(values.get(currentKey)).toBe('[{"id":"custom:1","name":"Meu filtro","filters":{"status":"open"}}]');
    expect(values.has(legacyKey)).toBe(false);
    expect(loadOperationalEventPresets(storage, 'user-1', 'tenant-a').migratedFromLegacy).toBe(false);
  });

  it('persiste e restaura filtros avançados e usa sete dias civis inclusivos', () => {
    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    for (const field of ['driverId', 'clientId', 'loadId', 'impactMin', 'impactMax', 'hasImpact', 'responsibility']) {
      expect(page).toContain(`${field}:`);
    }
    expect(page).toContain("setDriverFilter(f.driverId ?? 'all')");
    expect(page).toContain("setClientFilter(f.clientId ?? 'all')");
    expect(page).toContain("setLoadFilter(f.loadId ?? 'all')");
    expect(page).toContain('shiftDateInputValue(tenantToday, -6)');
    expect(page).not.toContain('shiftDateInputValue(tenantToday, -7)');
    expect(page).toContain('shiftDateInputValue(tenantToday, -29)');
    expect(page).toContain('shiftDateInputValue(tenantToday, -89)');
    expect(page.match(/dateToISO: tenantToday/g)).toHaveLength(3);
    expect(page).toContain('setDateTo(dateInputPickerValue(tenantToday))');
  });

  it('preserva a base temporal e aplica o preset resolvido sobre a data de resolução', () => {
    expect(parseOperationalEventPresets('[{"id":"x","name":"Resolvidas","filters":{"dateBasis":"resolved_at"}}]'))
      .toEqual([{ id: 'x', name: 'Resolvidas', filters: { dateBasis: 'resolved_at' } }]);
    expect(parseOperationalEventPresets('[{"id":"x","name":"Inválido","filters":{"dateBasis":"updated_at"}}]'))
      .toBeNull();

    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    expect(page).toMatch(/builtin:resolved-7d[\s\S]{0,250}dateBasis: 'resolved_at'/);
    expect(page).toContain("setDateBasis(f.dateBasis === 'resolved_at' ? 'resolved_at' : 'created_at')");
  });
});
