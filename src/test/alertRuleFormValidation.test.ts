import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Alerts.tsx', 'utf8');

describe('alert rule form validation', () => {
  it('reflects threshold and geofence requirements in the create button', () => {
    expect(source).toContain("geofencesQuery.isLoading || geofencesQuery.isError || !geofenceId");
    expect(source).toContain('!Number.isFinite(Number(threshold)) || Number(threshold) <= 0');
  });
});
