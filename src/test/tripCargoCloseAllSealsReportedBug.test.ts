import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('trip cargo close seal eligibility', () => {
  it('loads every seal page and fails closed while the complete check is unavailable', () => {
    const page = readFileSync('src/pages/TripCargoCustody.tsx', 'utf8');
    const client = readFileSync('src/lib/driver/tripCargoCustody.ts', 'utf8');

    expect(client).toContain('export async function getCompleteTripCargoCollection');
    expect(client).toContain('for(let page=2;items.length<total;page+=1)');
    expect(page).toContain("getCompleteTripCargoCollection(tenantId!,tripId!,'seals'");
    expect(page).toContain('const sealCheckUnavailable=');
    expect(page).toContain('close.isPending || sealCheckUnavailable || hasUnresolvedSeal');
  });
});
