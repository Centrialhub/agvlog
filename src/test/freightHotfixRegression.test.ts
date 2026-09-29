import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFreightSimulatorSource } from '@/lib/freight/freightSimulatorSource';
import { applyCteFreightDefaults } from '@/lib/fiscal/ctePreviewFreight';
const state = vi.hoisted(() => ({ row: { id: 'cte', client_id: 'recipient', document_type: 'outbound' }, filters: [] as unknown[][] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: () => { throw new Error('RPC unavailable in production'); },
  from: () => {
    const query = { select: () => query, eq: (...args: unknown[]) => { state.filters.push(args); return query; },
      is: (...args: unknown[]) => { state.filters.push(args); return query; },
      single: async () => ({ data: state.row, error: null }) };
    return query;
  },
} }));
beforeEach(() => { state.filters = []; state.row = { id: 'cte', client_id: 'recipient', document_type: 'outbound' }; });
describe('revisão do hotfix antes da publicação', () => {
  it('simula CT-e com fornecedor explícito sem depender da RPC ausente', async () => {
    await expect(readFreightSimulatorSource('tenant-a', 'cte', 'supplier')).resolves.toEqual({ recipientId: 'recipient', sourceDocumentIds: undefined });
    expect(state.filters).toEqual([['tenant_id', 'tenant-a'], ['id', 'cte'], ['deleted_at', null]]);
  });
  it('não confunde a transportadora do CT-e com o remetente das NF-es', async () => {
    await expect(readFreightSimulatorSource('tenant-a', 'cte', null)).rejects.toThrow('selecione o fornecedor');
  });
  it('preserva resolução automática do remetente para NF-e', async () => {
    state.row = { ...state.row, id: 'nf', document_type: 'inbound' };
    await expect(readFreightSimulatorSource('tenant-a', 'nf', null)).resolves.toMatchObject({ sourceDocumentIds: ['nf'] });
  });
  it('resposta atrasada não apaga base e valor de ICMS editados', () => {
    const base = { freightValue: 100, fcFreightWeight: 100, icmsAliquota: 12, icmsEmbutido: false, icmsIsento: false, icmsBase: 100, icmsValor: 12 };
    const previous = { ...base, icmsBase: 75, icmsValor: 9 };
    expect(applyCteFreightDefaults(base, previous, { ...previous, freightValue: 200 }, 200))
      .toMatchObject({ freightValue: 200, fcFreightWeight: 200, icmsBase: 75, icmsValor: 9 });
    expect(applyCteFreightDefaults(base, base, base, 200)).toMatchObject({ icmsBase: 200, icmsValor: 24 });
  });
});
