import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecalculateInboundFreight } from '@/hooks/useRecalculateInboundFreight';
import { resolveNFSeServiceValue } from '@/lib/fiscal/nfseServiceValue';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, writes: [] as Row[] }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const predicates: ((row: Row) => boolean)[] = [];
  let start = 0, end = 499, patch: Row | null = null;
  const query = {
    select: () => query, order: () => query,
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query; },
    lte: (key: string, value: string) => { predicates.push(row => String(row[key]) <= value); return query; },
    range: (from: number, to: number) => { start = from; end = to; return query; },
    update: (value: Row) => { patch = value; return query; },
    upsert: () => query,
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (state.rows[table] || []).filter(row => predicates.every(predicate => predicate(row))).slice(start, end + 1);
      if (patch) for (const row of rows) { state.writes.push({ id: row.id, ...patch }); Object.assign(row, patch); }
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return query;
} } }));

function document(id: string, weight: number, freight: number | null = null) {
  return { id, tenant_id: 'tenant', document_type: 'inbound', deleted_at: null, client_id: 'recipient',
    recipient: 'Destino', recipient_city: 'Belo Horizonte', recipient_state: 'MG',
    remitter_cnpj: '11222333000181', weight_kg: weight, value: 10000, pallet_count: 1,
    freight_value: freight, freight_overridden: false };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(useRecalculateInboundFreight, { wrapper: ({ children }: PropsWithChildren) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  state.writes = [];
  state.rows = {
    clients: [{ id: 'supplier', tenant_id: 'tenant', tax_id: '11222333000181', is_supplier: true, payer_group: 'GROUP' }],
    client_regions: [],
    freight_tables: [{ id: 'table', tenant_id: 'tenant', client_id: 'supplier', payer_group: 'GROUP',
      table_name: 'Tabela QA', table_code: 1, blocked: false, valid_from: '2026-01-01', valid_until: null, per_kg_value: 2, min_value: 0 }],
    fiscal_documents: [document('nf-1', 40), document('nf-2', 60)],
  };
});
afterEach(cleanup);

it.each([['nf-1'], ['nf-1', 'nf-2']])('real calculator and recalculation hook prefill each note independently: %j', async (...ids) => {
  const { result } = mount();
  await act(async () => {
    expect(await result.current.mutateAsync(ids)).toEqual({ updated: ids.length, skipped: 0, failed: 0, failedIds: [] });
  });
  expect(state.writes.map(row => ({ id: row.id, freight_value: row.freight_value, freight_table_id: row.freight_table_id })))
    .toEqual(ids.map((id, index) => ({ id, freight_value: index === 0 ? 80 : 120, freight_table_id: 'table' })));
  expect(state.rows.fiscal_documents.map(row => row.value)).toEqual([10000, 10000]);
  expect(ids.map(id => resolveNFSeServiceValue(state.rows.fiscal_documents.find(row => row.id === id)?.freight_value)))
    .toEqual(ids.map((_, index) => index === 0 ? 80 : 120));
});

it('preserves manual freight and explicitly reports a failed source without substituting products', async () => {
  state.rows.fiscal_documents[0] = { ...document('nf-1', 40, 33.33), freight_overridden: true };
  state.rows.fiscal_documents[1].remitter_cnpj = '22333444000181';
  const { result } = mount();
  await act(async () => {
    expect(await result.current.mutateAsync(['nf-1', 'nf-2'])).toEqual({ updated: 0, skipped: 1, failed: 1, failedIds: ['nf-2'] });
  });
  expect(state.writes).toEqual([]);
  expect(state.rows.fiscal_documents[0].freight_value).toBe(33.33);
  expect(resolveNFSeServiceValue(state.rows.fiscal_documents[1].freight_value)).toBe(0);
});
