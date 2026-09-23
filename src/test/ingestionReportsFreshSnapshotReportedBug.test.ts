import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ingestion report snapshot refresh regression', () => {
  it('clears the snapshot when returning to page one or retrying a paged request', () => {
    const source = readFileSync('src/pages/IngestionReports.tsx', 'utf8');

    expect(source).toContain('if (page === 2) resetPage()');
    expect(source).toContain('onClick={previousPage}');
    expect(source).toContain('onClick={retryWithFreshSnapshot}');
    expect(source).toContain('else resetPage()');
  });
});
