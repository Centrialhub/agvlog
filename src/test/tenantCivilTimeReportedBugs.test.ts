import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dateOnlyUtcRange, localDateTimeInputToIso, localDateTimeInputValue } from '@/lib/utils/formatDate';
import { futurePortalPickupIso } from '@/lib/portal/portalRequestValidation';

describe('calendário civil contratual do tenant',()=>{
  it('converte datas e horários pelo fuso informado, não pelo dispositivo',()=>{
    expect(dateOnlyUtcRange('2026-09-21','America/Sao_Paulo').from).toBe('2026-09-21T03:00:00.000Z');
    expect(dateOnlyUtcRange('2026-09-21','UTC').from).toBe('2026-09-21T00:00:00.000Z');
    expect(localDateTimeInputToIso('2026-09-21T10:00','UTC')).toBe('2026-09-21T10:00:00.000Z');
    expect(localDateTimeInputValue('2026-09-21T10:00:00.000Z','UTC')).toBe('2026-09-21T10:00');
    expect(futurePortalPickupIso('2026-09-21T10:00',0,'UTC')).toBe('2026-09-21T10:00:00.000Z');
  });

  it('propaga o timezone do tenant nos três filtros e na tela de coleta',()=>{
    const files=['src/pages/IngestionReports.tsx','src/hooks/portal/usePortalPickups.ts','src/hooks/portal/usePortalPods.ts'];
    files.forEach((file)=>expect(readFileSync(file,'utf8')).toMatch(/currentTenant!?\.timezone/));
    const pickups=readFileSync('src/pages/portal/PortalPickups.tsx','utf8');
    expect(pickups).toContain('futurePortalPickupIso(form.pickup_at, Date.now(), tenantTimeZone)');
    expect(pickups).toContain('Data/Hora da coleta ({tenantTimeZone})');
    expect(pickups).toContain('timeZone: tenantTimeZone');
  });
});
