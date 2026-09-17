import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync('src/components/financial/StatementHistoryDetail.tsx', 'utf8');

describe('mutable filtered statement-line paging', () => {
  it('returns to the first page after both review mutations', () => {
    const reset = 'setFilters(current=>({...current,page:1}))';
    expect(detail.split(reset)).toHaveLength(3);

    const reversal = detail.indexOf('<StatementReviewReversal');
    const review = detail.indexOf('<StatementIdentityReview', reversal);
    expect(detail.indexOf(reset, reversal)).toBeLessThan(review);
    expect(detail.indexOf(reset, review)).toBeGreaterThan(review);
  });
});
