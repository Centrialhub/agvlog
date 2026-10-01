import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn(), emit: vi.fn(), toast: { error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-a' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'operator-a' } }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => state.toast }));
vi.mock('@/lib/fiscal/hubFiscalClient', () => ({ hubFiscal: { emit: state.emit } }));
import { useIssueCTe, type IssueCteGroupInput } from '@/hooks/useIssueCTe';
import { applyCteFreightPatch } from '@/lib/fiscal/ctePreviewFreight';

function input(): IssueCteGroupInput {
  const draft = applyCteFreightPatch({ freightValue: 100, fcFreightWeight: 100, icmsAliquota: 12,
    icmsEmbutido: false, icmsIsento: false, icmsBase: 100, icmsValor: 12 }, { freightValue: 1234.56 });
  return {
    emitter: { id: 'emitter-a', cnpj: '18666510000168', name: 'Emissor', environment: 'sandbox' },
    remitter: { name: 'Remetente', cnpj: '14998371003215' },
    recipient: { name: 'Destino', cnpj: '07734610000168', address: { street: 'Rua Teste', number: '1',
      neighborhood: 'Centro', city: 'Pirapora', state: 'MG', city_ibge: '3151206', zip: '39270000' } },
    insurer: { name: 'Seguradora', cnpj: '18666510000168', policy: 'AP-1', endorsement: 'AV-1' },
    takerRole: 'destinatario', driver: null, vehicle: null, nature: 'PRESTACAO',
    invoices: [{ access_key: '3'.repeat(44), number: '1', value: 1000 }],
    totals: { freight_value: draft.freightValue, cargo_value: 1000, weight_kg: 50, pallet_count: 2 },
    freightComposition: { freight_weight: draft.fcFreightWeight },
    icms: { cst: '00', aliquota: 12, base: draft.icmsBase, valor: draft.icmsValor, embutido: false },
    fiscal_document_ids: ['nf-a'], load_ids: [], meta: { client_id: 'client-a' },
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(useIssueCTe, { wrapper: ({ children }: PropsWithChildren) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { state.rpc.mockReset(); state.emit.mockReset(); });
afterEach(cleanup);
describe('frete manual até o limite de despacho: builder e hook reais, RPC/provedor simulados', () => {
  it.each([0, null, undefined, -1, NaN])('blocks empty/invalid freight %s before reservation or provider calls', async freight => {
    const request = input();
    request.totals.freight_value = freight as number;
    const { result } = mount();
    await act(async () => { await expect(result.current.mutateAsync(request)).rejects.toThrow('Valor do frete'); });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalled();
  });
  it('reserva e despacha o mesmo valor decimal preenchido', async () => {
    state.rpc.mockImplementation(async (_name, args) => ({ error: null, data: {
      id: '10000000-0000-4000-8000-000000000099', tenant_id: 'tenant-a', emitter_id: 'emitter-a',
      cte_payload: structuredClone(args._snapshot.cte_payload),
    } }));
    state.emit.mockResolvedValue({ success: true, hub: { document: { status: 'processing' } } });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(input()); });
    expect(state.rpc).toHaveBeenCalledWith('prepare_cte_issue', expect.objectContaining({
      _snapshot: expect.objectContaining({ freight_value: 1234.56, cte_payload: expect.objectContaining({
        payload: expect.objectContaining({ vPrest: expect.objectContaining({ vTPrest: 1234.56, vRec: 1234.56 }) }),
      }) }),
    }));
    expect(state.emit).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({
      payload: expect.objectContaining({ valores: expect.objectContaining({ valorFreteBase: 1234.56 }),
        vPrest: expect.objectContaining({ vTPrest: 1234.56, vRec: 1234.56 }) }),
    }) }));
  });
  it('recusa snapshot anterior incompatível sem despachar uma nova emissão', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'fiscal_snapshot_changed_reconcile_first' } });
    const { result } = mount();
    await act(async () => { await expect(result.current.mutateAsync(input())).rejects.toThrow('outros valores'); });
    expect(state.emit).not.toHaveBeenCalled();
  });
});
