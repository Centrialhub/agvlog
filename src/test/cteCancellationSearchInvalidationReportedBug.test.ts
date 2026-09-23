import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CT-e cancellation search cache invalidation regression', () => {
  it('refreshes cte_search after both success and error responses', () => {
    const source = readFileSync('src/hooks/useIssueCTe.tsx', 'utf8');
    const cancelHook = source.slice(
      source.indexOf('export function useCancelCTe()'),
      source.indexOf('export function useResendCte()'),
    );

    expect(cancelHook.match(/queryKey:\s*\['cte_search'\]/g)).toHaveLength(2);
  });
});
