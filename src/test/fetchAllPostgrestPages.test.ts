import { describe, expect, it, vi } from 'vitest';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

describe('fetchAllPostgrestPages', () => {
  it('continua após uma página cheia e preserva todos os registros', async () => {
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: from === 0
        ? Array.from({ length: to - from + 1 }, (_, index) => index)
        : [500, 501],
      error: null,
    }));

    const rows = await fetchAllPostgrestPages(fetchPage, 500);

    expect(rows).toHaveLength(502);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 499);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it('interrompe e propaga o erro da API sem devolver uma lista parcial', async () => {
    const failure = new Error('consulta indisponível');
    const fetchPage = vi.fn(async (from: number) => ({
      data: from === 0 ? [1, 2] : null,
      error: from === 0 ? null : failure,
    }));

    await expect(fetchAllPostgrestPages(fetchPage, 2)).rejects.toBe(failure);
  });
});
