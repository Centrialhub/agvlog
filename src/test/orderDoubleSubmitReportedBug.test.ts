import { describe, expect, it } from 'vitest';

describe('bug 1055 de envio duplicado de pedido', () => {
  it('guards locally and from the mutation pending state until save settles', async () => {
    const source = (await import('@/pages/Orders?raw')).default;
    expect(source).toContain('if (submitting || isSaving) return');
    expect(source).toContain('await onSave(out as unknown as Partial<Order>)');
    expect(source).toContain('setSubmitting(false)');
    expect(source).toContain('disabled={!form.order_number.trim() || submitting || isSaving}');
    expect(source).toContain('isSaving={createOrder.isPending || updateOrder.isPending}');
  });
});
