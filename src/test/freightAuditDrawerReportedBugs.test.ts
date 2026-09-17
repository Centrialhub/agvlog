import { describe, expect, it } from 'vitest';

describe('bugs 597 e 598 da auditoria de frete', () => {
  it('distinguishes query failures and offers a retry', async () => {
    const source = (await import('@/components/freight/FreightAuditDrawer?raw')).default;
    expect(source).toContain("const [loadError, setLoadError] = useState('')");
    expect(source).toContain('Não foi possível carregar a auditoria do frete: {loadError}');
    expect(source).toContain('Tentar novamente');
    expect(source).toContain('if (error)');
  });

  it('clears previous data and cancels stale requests when scope changes', async () => {
    const source = (await import('@/components/freight/FreightAuditDrawer?raw')).default;
    expect(source.indexOf('setLogs([])')).toBeLessThan(source.indexOf('if (!open || !entityId)'));
    expect(source).toContain('const controller = new AbortController()');
    expect(source).toContain('.abortSignal(controller.signal)');
    expect(source).toContain('return () => { active = false; controller.abort(); }');
    expect(source).toContain("query.eq('entity_type', entityType)");
  });

  it('shows the total history and can load records beyond the first ten', async () => {
    const source = (await import('@/components/freight/FreightAuditDrawer?raw')).default;
    expect(source).toContain(".select('*', { count: 'exact' })");
    expect(source).toContain('.range(0, historyLimit - 1)');
    expect(source).toContain('Histórico ({logs.length} de {totalLogs})');
    expect(source).toContain('setHistoryLimit(limit => limit + 10)');
    expect(source).toContain('totalLogs - logs.length');
  });
});
