import { describe, expect, it } from 'vitest';
import { getEdgeFunctionErrorMessage } from '@/lib/ingestion/edgeFunctionError';

describe('ORT extraction transport errors', () => {
  it('reads the cloned response without consuming the original response', async () => {
    const response = new Response(JSON.stringify({ error: 'Limite de extração excedido', message: 'Generic message' }));
    expect(await getEdgeFunctionErrorMessage({ message: 'non-2xx', context: response }))
      .toBe('Limite de extração excedido');
    expect(response.bodyUsed).toBe(false);
  });

  it('uses the response message when the error detail is empty', async () => {
    expect(await getEdgeFunctionErrorMessage({ message: 'non-2xx', context: {
      json: async () => ({ error: ' ', message: 'Detalhe do servidor' }),
    } })).toBe('Detalhe do servidor');
  });

  it('keeps the original message when the response is unreadable', async () => {
    expect(await getEdgeFunctionErrorMessage({ message: 'Falha de transporte', context: {
      json: async () => { throw new Error('invalid response'); },
    } })).toBe('Falha de transporte');
  });

  it('provides a useful fallback for an opaque server error', async () => {
    expect(await getEdgeFunctionErrorMessage({ message: 'Edge Function returned non-2xx' }))
      .toContain('sem detalhe legível');
  });
});
