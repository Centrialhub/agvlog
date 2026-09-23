import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('statement history after identity review mutations', () => {
  it('returns to page one and releases the old snapshot after review and reversal', () => {
    const detail = readFileSync('src/components/financial/StatementHistoryDetail.tsx', 'utf8');
    const reset = 'setHistoryPage(1);historySnapshot.current=null;';

    expect(detail.split(reset)).toHaveLength(3);
    expect(detail.indexOf(reset, detail.indexOf('<StatementReviewReversal'))).toBeLessThan(detail.indexOf('<StatementIdentityReview', detail.indexOf('<StatementReviewReversal')));
    expect(detail.indexOf(reset, detail.indexOf('<StatementIdentityReview'))).toBeGreaterThan(detail.indexOf('<StatementIdentityReview'));
  });
});
