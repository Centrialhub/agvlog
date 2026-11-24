import type { ParsedNFeItem } from '@/lib/documentParsers';

export function invoiceProductSource(items: ParsedNFeItem[]) {
  if (!items.length) return undefined;
  if (items.length > 1000) throw new Error('A nota excede o limite de 1.000 produtos.');
  return { version: 1, items: items.map((item, index) => {
    if (!item.description.trim() || item.description.length > 2000 || !Number.isFinite(item.quantity) || item.quantity <= 0
      || item.quantity > 1e12 || !Number.isFinite(item.totalPrice) || item.totalPrice < 0 || item.totalPrice > 1e15) {
      throw new Error(`Produto ${index + 1}: confira a descrição, quantidade e valor no XML antes de importar.`);
    }
    return { line: index + 1, code: (item.code || '').slice(0, 120), description: item.description.trim(),
      quantity: item.quantity, unit: item.unit?.trim().slice(0, 20) || 'UN', total: item.totalPrice };
  }) };
}
