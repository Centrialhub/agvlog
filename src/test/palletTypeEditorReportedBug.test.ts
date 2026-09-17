import { describe, expect, it } from 'vitest';

describe('bug 1087 do cadastro de tipos de palete', () => {
  it('awaits persistence, reports failures, and clears fields only after success', async () => {
    const source = (await import('@/pages/PalletReturns?raw')).default;
    expect(source).toContain('await upsertType.mutateAsync(palletType)');
    expect(source).toContain("title: 'Não foi possível salvar o tipo de palete'");
    expect(source).toContain('await onSave({ code, name');
    expect(source.indexOf('await onSave({ code, name')).toBeLessThan(source.indexOf("setCode(''); setName('');"));
    expect(source).toContain("catch { /* Parent keeps the typed values");
    expect(source).toContain('disabled={saving}');
  });
});
