import { describe, expect, it } from 'vitest';
import { paginateItems } from '@/hooks/usePagination';

describe('data pagination', () => {
  const rows = Array.from({ length: 123 }, (_, index) => index + 1);

  it('returns a bounded page and accessible result range', () => {
    expect(paginateItems(rows, 2, 50)).toMatchObject({
      items: Array.from({ length: 50 }, (_, index) => index + 51),
      page: 2,
      pageCount: 3,
      totalCount: 123,
      start: 51,
      end: 100,
    });
  });

  it('clamps stale pages after filters reduce the result set', () => {
    expect(paginateItems(rows.slice(0, 7), 9, 50)).toMatchObject({
      page: 1,
      pageCount: 1,
      start: 1,
      end: 7,
    });
  });
});
