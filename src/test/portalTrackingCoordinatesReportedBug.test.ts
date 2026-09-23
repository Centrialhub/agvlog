import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('portal tracking coordinate regression', () => {
  it('normalizes invalid coordinate pairs before exposing hook data', () => {
    const hook = readFileSync('src/hooks/portal/usePortalTracking.ts', 'utf8');
    expect(hook).toContain('hasValidGeographicCoordinates(item.lat, item.lng)');
    expect(hook).toContain('lat: validCoordinates ? item.lat : null');
    expect(hook).toContain('lng: validCoordinates ? item.lng : null');
  });

  it('filters again at both portal map boundaries', () => {
    const page = readFileSync('src/pages/portal/PortalTracking.tsx', 'utf8');
    const map = readFileSync('src/components/portal/PortalTrackingMap.tsx', 'utf8');
    expect(page).toContain('hasValidGeographicCoordinates(i.lat, i.lng)');
    expect(map).toContain('hasValidGeographicCoordinates(i.lat, i.lng)');
  });

  it('suppresses invalid legacy rows in the portal RPC projection', () => {
    const migration = readFileSync(
      'supabase/migrations/20260921133000_filter_invalid_portal_tracking_coordinates.sql',
      'utf8',
    );
    expect(migration.match(/lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180/g)).toHaveLength(2);
    expect(migration).toContain('portal_tracking_coordinate_contract_not_found');
  });
});
