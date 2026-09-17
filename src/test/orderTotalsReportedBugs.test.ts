import { describe, expect, it } from 'vitest';

describe('bugs 1051 a 1053 dos totais do pedido', () => {
  it('labels tax values as calculated read-only fields', async () => {
    const source = (await import('@/pages/Orders?raw')).default;
    expect(source).toContain("opts?.readOnly ? ' (calculado)' : ''");
    expect(source).toContain('readOnly={opts?.readOnly}');
    for (const label of ['Valor ICMS (R$)', 'Valor PIS (R$)', 'Valor COFINS (R$)', 'Valor CBS (R$)', 'Valor IBS (R$)']) {
      expect(source).toContain(`${label}', form.`);
    }
    expect(source.match(/\{ readOnly: true \}/g)).toHaveLength(5);
  });

  it('persists fallback tax bases and rejects discounts above subtotal', async () => {
    const source = (await import('@/pages/Orders?raw')).default;
    expect(source).toContain("icms_base: base('icms_base').toFixed(2)");
    expect(source).toContain("cbs_base: base('cbs_base').toFixed(2)");
    expect(source).toContain("ibs_base: base('ibs_base').toFixed(2)");
    expect(source).toContain('n(form.discount_value) > n(calculated.subtotal)');
    expect(source).toContain('O desconto não pode ser maior que o subtotal do frete.');
  });
});
