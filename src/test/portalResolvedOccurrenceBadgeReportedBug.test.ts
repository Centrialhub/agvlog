import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isOpenPortalOccurrence } from '@/lib/portal/occurrenceStatus';

describe('portal shipment resolved occurrence badge regression', () => {
  it('treats only unresolved, non-closed occurrences as open', () => {
    expect(isOpenPortalOccurrence({ public_status: 'open', resolved_at: null })).toBe(true);
    expect(isOpenPortalOccurrence({ public_status: null, resolved_at: null })).toBe(true);
    expect(isOpenPortalOccurrence({ public_status: 'open', resolved_at: '2026-09-21T12:00:00Z' })).toBe(false);
    expect(isOpenPortalOccurrence({ public_status: 'resolved', resolved_at: null })).toBe(false);
    expect(isOpenPortalOccurrence({ public_status: 'closed', resolved_at: null })).toBe(false);
    expect(isOpenPortalOccurrence({ public_status: 'cancelled', resolved_at: null })).toBe(false);
  });

  it('uses the open subset for the header status and badge while retaining the full history', () => {
    const page = readFileSync('src/pages/portal/PortalShipmentDetail.tsx', 'utf8');
    expect(page).toContain('data.occurrences?.filter(isOpenPortalOccurrence)');
    expect(page.match(/openOccurrences\.length > 0/g)).toHaveLength(2);
    expect(page).toContain('data.occurrences.map((o) =>');
    expect(page).toContain('Ocorrências ({data.occurrences?.length ?? 0})');
  });
});
