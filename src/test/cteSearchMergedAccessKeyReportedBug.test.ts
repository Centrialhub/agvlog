import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('merged CT-e access key regression', () => {
  it('falls back to the authoritative fiscal document access key', () => {
    const source = readFileSync('src/hooks/useCteSearch.tsx', 'utf8');

    expect(source).toContain('access_key: r.access_key ?? match?.access_key ?? null');
  });
});
