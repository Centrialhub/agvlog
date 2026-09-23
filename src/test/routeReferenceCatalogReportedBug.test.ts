import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('route reference catalogs', () => {
  it('pages through every geofence and POI instead of truncating at 200', () => {
    const source = readFileSync('src/pages/Routes.tsx', 'utf8');
    expect(source.match(/fetchAllPostgrestPages</g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('.limit(200)');
    expect(source.match(/\.range\(from,to\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
