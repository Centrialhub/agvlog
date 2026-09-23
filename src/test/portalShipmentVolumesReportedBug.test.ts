import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('volumes da mercadoria no portal', () => {
  it('projeta e renderiza volume_count sem confundir pallets', () => {
    const migration = readFileSync('supabase/migrations/20260921125000_expose_portal_shipment_volume_count.sql', 'utf8');
    const page = readFileSync('src/pages/portal/PortalShipments.tsx', 'utf8');
    const hook = readFileSync('src/hooks/portal/usePortalShipments.ts', 'utf8');
    expect(migration).toContain('fd.product_summary, fd.volume_count, fd.pallet_count');
    expect(hook).toContain('volume_count: number | null');
    expect(page).toContain('{r.volume_count ?? 0}');
    expect(page).not.toContain('{r.pallet_count ?? 0}');
  });
});
