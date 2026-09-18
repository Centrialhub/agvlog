import { describe, expect, it } from 'vitest';

describe('bug 618 do assistente de NFS-e', () => {
  it('initializes once per open tenant/user scope instead of once per emitters refetch', async () => {
    const source = (await import('@/components/nfse/NFSeFromInvoicesDialog?raw')).default;
    expect(source).toContain('const initializedScopeRef = useRef<string | null>(null)');
    expect(source).toContain('if (initializedScopeRef.current === scope) return');
    expect(source).toContain('initializedScopeRef.current = scope');
    expect(source).toContain('}, [open, batchStorageKey]);');
    expect(source).toContain('}, [open, emitters, emitterId]);');
  });
});
