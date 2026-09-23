import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasValidGeographicCoordinates } from '@/lib/maps/coordinates';

describe('operations fleet coordinate regression', () => {
  it.each([
    [Number.NaN, -46],
    [Number.POSITIVE_INFINITY, -46],
    [-23, Number.NEGATIVE_INFINITY],
    [90.000001, 0],
    [-90.000001, 0],
    [0, 180.000001],
    [0, -180.000001],
  ])('rejects an invalid map point (%s, %s)', (latitude, longitude) => {
    expect(hasValidGeographicCoordinates(latitude, longitude)).toBe(false);
  });

  it.each([
    [-90, -180],
    [0, 0],
    [90, 180],
    [-23.55052, -46.633308],
  ])('accepts a valid map point (%s, %s)', (latitude, longitude) => {
    expect(hasValidGeographicCoordinates(latitude, longitude)).toBe(true);
  });

  it('filters invalid rows at the fleet reader and again before rendering', () => {
    const hook = readFileSync('src/hooks/usePositions.tsx', 'utf8');
    const page = readFileSync('src/pages/OperationsCenter.tsx', 'utf8');
    expect(hook).toContain('page.filter((position) => hasValidGeographicCoordinates(position.lat, position.lng))');
    expect(page).toContain('enrichedVehicles.filter(e => hasValidGeographicCoordinates(e.lat, e.lng))');
  });

  it('rejects future invalid latest positions in the database', () => {
    const migration = readFileSync(
      'supabase/migrations/20260921131500_reject_invalid_latest_position_coordinates.sql',
      'utf8',
    );
    expect(migration).toContain('lat between -90 and 90');
    expect(migration).toContain('lng between -180 and 180');
    expect(migration).toContain('not valid');
  });
});
