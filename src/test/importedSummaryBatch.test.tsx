import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImportedNoteSummaryTotals, useImportedNotes } from '@/hooks/useImportedNotesSummary';

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, requests: [] as URL[], failSecond: false, overlaps: 0 }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-a', timezone: 'America/Sao_Paulo' } }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); fixture.requests.push(url);
      if (url.href.length > 8000) return new Response('Bad Request', { status: 400 });
      const table = url.pathname.split('/').pop()!;
      if (table === 'cte_documents' && ++fixture.overlaps === 2 && fixture.failSecond) {
        return new Response(JSON.stringify({ message: 'Falha no segundo lote' }), { status: 500 });
      }
      let rows = [...(fixture.rows[table] || [])];
      for (const [field, expression] of url.searchParams) {
        if (['select', 'order', 'limit'].includes(field)) continue;
        const dot = expression.indexOf('.'), op = expression.slice(0, dot), value = expression.slice(dot + 1);
        rows = rows.filter(row => op === 'eq' ? row[field] === value
          : op === 'is' ? row[field] == null
          : op === 'in' ? value.slice(1, -1).split(',').includes(String(row[field]))
          : op === 'ov' ? (row[field] as string[] || []).some(id => value.slice(1, -1).split(',').includes(id)) : true);
      }
      const order = url.searchParams.get('order')?.split('.')[0];
      if (order) rows.sort((a, b) => String(b[order] || '').localeCompare(String(a[order] || '')));
      return new Response(JSON.stringify(rows), { status: 200 });
    } },
  }) };
});
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const note = (n: number): Row => ({ id: id(n), tenant_id: 'tenant-a', document_type: 'inbound', deleted_at: null, value: 10, weight_kg: 1, volume_count: 1, freight_cif_value: 2 });
beforeEach(() => {
  fixture.rows = { fiscal_documents: [], cte_documents: [], nfse_documents: [] };
  fixture.requests = []; fixture.failSecond = false; fixture.overlaps = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe('imported summary bounded fiscal lookups', () => {
  it.each([0, 50, 51, 911, 2000])('loads %i notes without oversized URLs or losing totals', async count => {
    fixture.rows.fiscal_documents = Array.from({ length: count }, (_, n) => note(n));
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(count);
    expect(getImportedNoteSummaryTotals(result.current.data!).totalValue).toBe(count * 10);
    expect(fixture.requests.every(url => url.href.length < 3000)).toBe(true);
    expect(fixture.requests.every(url => url.searchParams.get('tenant_id') === 'eq.tenant-a')).toBe(true);
  });
  it('selects the newest CT-e and NFS-e for a note in a later batch', async () => {
    fixture.rows.fiscal_documents = Array.from({ length: 51 }, (_, n) => note(n));
    for (const table of ['cte_documents', 'nfse_documents']) fixture.rows[table] = [
      { id: 'old', tenant_id: 'tenant-a', fiscal_document_ids: [id(0), id(50)], status: table === 'cte_documents' ? 'authorized' : 'issued', issued_at: '2026-01-01', created_at: '2026-01-01' },
      { id: 'new', tenant_id: 'tenant-a', fiscal_document_ids: [id(50)], status: table === 'cte_documents' ? 'authorized' : 'issued', issued_at: '2026-02-01', created_at: '2026-02-01' },
      { id: 'cancelled', tenant_id: 'tenant-a', fiscal_document_ids: [id(50)], status: 'cancelled', issued_at: '2026-03-01', created_at: '2026-03-01' },
    ];
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.find(row => row.id === id(50))).toMatchObject({ cte_id: 'new', nfse_id: 'new' });
  });
  it('chunks direct CT-e and NFS-e references too', async () => {
    fixture.rows.fiscal_documents = Array.from({ length: 211 }, (_, n) => ({ ...note(n), cte_emitted_outbound_id: id(n + 1000), nfse_emitted_document_id: id(n + 2000) }));
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const direct = fixture.requests.filter(url => url.searchParams.has('id'));
    expect(direct).toHaveLength(10);
    expect(direct.every(url => url.href.length < 3000)).toBe(true);
  });
  it('uses authorized links instead of newer drafts/errors and does not process a ready load', async () => {
    fixture.rows.fiscal_documents = [note(0), note(1), { ...note(2), load_id: 'load', loads: { status: 'ready' } }];
    fixture.rows.cte_documents = [
      { id: 'authorized-cte', tenant_id: 'tenant-a', fiscal_document_ids: [id(0)], status: 'authorized', sefaz_status: 'authorized', issued_at: '2026-01-01', cte_number: '10' },
      { id: 'draft-cte', tenant_id: 'tenant-a', fiscal_document_ids: [id(0)], status: 'draft', issued_at: '2026-02-01', cte_number: '11' },
    ];
    fixture.rows.nfse_documents = [
      { id: 'issued-nfse', tenant_id: 'tenant-a', fiscal_document_ids: [id(1)], status: 'issued', created_at: '2026-01-01', nfse_number: '100' },
      { id: 'failed-nfse', tenant_id: 'tenant-a', fiscal_document_ids: [id(1)], status: 'error', created_at: '2026-02-01', rps_number: '101' },
    ];
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.find(r => r.id === id(0))).toMatchObject({ cte_id: 'authorized-cte', cte_number: '10', operational_status: 'processed' });
    expect(result.current.data?.find(r => r.id === id(1))).toMatchObject({ nfse_id: 'issued-nfse', nfse_number: '100', operational_status: 'processed' });
    expect(result.current.data?.find(r => r.id === id(2))).toMatchObject({ cte_id: null, nfse_id: null, operational_status: 'not_processed' });
  });
  it('applies the same authorization requirement to direct links and the processed filter', async () => {
    fixture.rows.fiscal_documents = [
      { ...note(0), cte_emitted_outbound_id: id(100) },
      { ...note(1), cte_emitted_outbound_id: id(101) },
      { ...note(2), nfse_emitted_document_id: id(102) },
      { ...note(3), nfse_emitted_document_id: id(103) },
      { ...note(4), imported_note_status: 'processed' },
      { id: id(100), tenant_id: 'tenant-a', document_type: 'outbound', status: 'authorized', sefaz_status: 'rejected' },
      { id: id(101), tenant_id: 'tenant-a', document_type: 'outbound', status: 'authorized', sefaz_status: 'authorized', invoice_number: '20' },
    ];
    fixture.rows.nfse_documents = [
      { id: id(102), tenant_id: 'tenant-a', fiscal_document_ids: [], status: 'issued', nfse_number: '30' },
      { id: id(103), tenant_id: 'tenant-a', fiscal_document_ids: [], status: 'rejected', rps_number: '31' },
    ];
    const { result } = renderHook(() => useImportedNotes({ status: 'processed' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(r => r.id).sort()).toEqual([id(1), id(2)]);
    expect(result.current.data?.find(r => r.id === id(2))).toMatchObject({ nfse_number: '30', nfse_status: 'issued' });
  });
  it('reports a failed batch instead of returning a partial financial report', async () => {
    fixture.rows.fiscal_documents = Array.from({ length: 51 }, (_, n) => note(n)); fixture.failSecond = true;
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'Falha no segundo lote' });
    expect(result.current.data).toBeUndefined();
  });
});
