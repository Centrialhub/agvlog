import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/MerchandiseShortages.tsx', 'utf8');

describe('shortage import preview atomicity', () => {
  it('clears stale state first and publishes parser output with its matching hash only after success', () => {
    const handler = page.slice(page.indexOf('const handleFile'), page.indexOf('const commitImport'));
    const clearPreview = handler.indexOf('setPreview(null)');
    const parse = handler.indexOf('parseShortageWorkbook');
    const publishPreview = handler.indexOf('setPreview(parsed)');
    const publishHash = handler.indexOf('setPreviewFingerprint(fingerprint)');
    expect(clearPreview).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(clearPreview);
    expect(publishPreview).toBeGreaterThan(parse);
    expect(publishHash).toBeGreaterThan(parse);
    expect(handler).toContain('selection !== fileSelectionRef.current');
    expect(handler).toContain('catch (error)');
    expect(handler).toContain("toast.error(error instanceof Error ? error.message : 'Não foi possível ler a planilha de faltas.')");
  });
});
