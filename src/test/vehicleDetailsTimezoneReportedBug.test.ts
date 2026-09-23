import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optionalLocalDateUtcRange } from '@/lib/utils/formatDate';

describe('fuso do tenant na ficha do veículo', () => {
  it('calcula o intervalo histórico pelo fuso informado', () => {
    expect(optionalLocalDateUtcRange('2026-09-21', 'UTC')).toEqual({
      from: '2026-09-21T00:00:00.000Z',
      toExclusive: '2026-09-22T00:00:00.000Z',
    });
    expect(optionalLocalDateUtcRange('2026-09-21', 'America/Sao_Paulo')).toEqual({
      from: '2026-09-21T03:00:00.000Z',
      toExclusive: '2026-09-22T03:00:00.000Z',
    });
  });

  it('vincula hoje, métricas e histórico ao timezone da empresa', () => {
    const source = readFileSync('src/pages/VehicleDetails.tsx', 'utf8');
    expect(source).toContain('useCivilDay(tenantTimeZone)');
    expect(source).toContain("['vehicle_today_metrics', currentTenant?.id, vehicleId, tenantTimeZone, today]");
    expect(source).toContain('optionalLocalDateUtcRange(historyDate, tenantTimeZone)');
    expect(source).not.toContain('localDateInputValue()');
  });
});
