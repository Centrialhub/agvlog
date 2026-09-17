import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const client = readFileSync('src/lib/driver/tripCargoCustody.ts', 'utf8');
const page = readFileSync('src/pages/TripCargoCustody.tsx', 'utf8');

describe('on-demand trip cargo dossier pages', () => {
  it('does not iterate every collection page while opening a dossier', () => {
    expect(client).not.toContain('for (let page = 1; page <= 10_000');
    expect(client).toContain("getTripCargoCollectionPage(tenantId, tripId, 'divergences', 1, 50");
  });

  it('requests later collection pages only through explicit navigation', () => {
    expect(page).toContain("enabled:!!available&&collectionPages.divergences>1");
    expect(page).toContain('<CollectionPagination');
  });
});
