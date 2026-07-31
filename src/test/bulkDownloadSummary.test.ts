import { describe, it, expect } from 'vitest';
import { summarizeBulkDownload } from '@/lib/fiscal/bulkDownloadSummary';

describe('summarizeBulkDownload', () => {
  it('reporta sucesso total', () => {
    const s = summarizeBulkDownload('pdf', 3, []);
    expect(s.tone).toBe('success');
    expect(s.title).toBe('3 arquivo(s) PDF baixado(s)');
    expect(s.description).toBeUndefined();
  });

  it('reporta falha parcial com motivo por item', () => {
    const s = summarizeBulkDownload('xml', 1, [{ label: '123', message: 'Hub sem XML' }]);
    expect(s.tone).toBe('warning');
    expect(s.title).toBe('1 baixado(s), 1 falha(s)');
    expect(s.description).toBe('CT-e 123: Hub sem XML');
  });

  it('usa erro quando nada foi baixado e resume excedentes', () => {
    const failures = Array.from({ length: 7 }, (_, i) => ({ label: `n${i}`, message: 'erro' }));
    const s = summarizeBulkDownload('pdf', 0, failures);
    expect(s.tone).toBe('error');
    expect(s.description).toContain('(+2 outras falhas)');
    expect(s.description!.split(' | ')).toHaveLength(5);
  });
});
