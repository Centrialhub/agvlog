import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve('src/hooks/portal/usePortalOccurrenceMessages.ts'),
  'utf8',
);

describe('reported portal occurrence message context race', () => {
  it('aborts an older-page request when tenant or occurrence changes', () => {
    expect(source).toContain("const contextKey = `${currentTenant?.id ?? ''}:${occurrenceId ?? ''}`");
    expect(source).toContain('olderRequestRef.current?.controller.abort()');
    expect(source).toContain('.abortSignal(args.signal)');
  });

  it('does not commit a page or error from a superseded request', () => {
    expect(source).toContain('if (olderRequestRef.current !== request || request.controller.signal.aborted) return;');
    expect(source).toContain('if (olderRequestRef.current === request)');
  });
});
