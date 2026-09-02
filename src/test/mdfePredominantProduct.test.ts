import { describe, expect, it } from 'vitest';
import {
  deriveMdfePredominantProduct,
  groupLinkedNfeProducts,
} from '@/lib/fiscal/mdfePredominantProduct';

describe('MDF-e predominant product', () => {
  it('links NF-e through reservations and keeps the legacy mirror as fallback', () => {
    const grouped = groupLinkedNfeProducts(
      [{ source_id: 'nfe-current', outbound_id: 'cte-current' }],
      [
        {
          id: 'nfe-current',
          cte_emitted_outbound_id: null,
          product_summary: 'Produto atual',
          value: 150,
          weight_kg: 20,
        },
        {
          id: 'nfe-legacy',
          cte_emitted_outbound_id: 'cte-legacy',
          product_summary: 'Produto legado',
          value: 80,
          weight_kg: 10,
        },
      ],
    );

    expect(grouped.get('cte-current')).toEqual([
      expect.objectContaining({ documentId: 'nfe-current', description: 'Produto atual' }),
    ]);
    expect(grouped.get('cte-legacy')).toEqual([
      expect.objectContaining({ documentId: 'nfe-legacy', description: 'Produto legado' }),
    ]);
  });

  it('selects the product with the greatest total NF-e value across selected CT-es', () => {
    const result = deriveMdfePredominantProduct([
      {
        linked_nfe_products: [
          { documentId: '1', description: 'Sucata de ferro', value: 70, weightKg: 100 },
          { documentId: '2', description: 'sucata de ferro', value: 60, weightKg: 80 },
        ],
      },
      {
        linked_nfe_products: [
          { documentId: '3', description: 'Alumínio', value: 120, weightKg: 500 },
        ],
      },
    ]);

    expect(result).toBe('Sucata de ferro');
  });

  it('uses weight as tie-breaker and the CT-e snapshot only when no linked NF-e has a product', () => {
    expect(deriveMdfePredominantProduct([
      {
        predominant_product: 'Fallback do CT-e',
        linked_nfe_products: [
          { documentId: '1', description: 'Produto leve', value: 100, weightKg: 10 },
          { documentId: '2', description: 'Produto pesado', value: 100, weightKg: 20 },
        ],
      },
    ])).toBe('Produto pesado');

    expect(deriveMdfePredominantProduct([
      { predominant_product: 'Fallback do CT-e', linked_nfe_products: [] },
    ])).toBe('Fallback do CT-e');
  });

  it('returns blank when neither NF-e nor CT-e contains a product description', () => {
    expect(deriveMdfePredominantProduct([{}])).toBe('');
  });
});
