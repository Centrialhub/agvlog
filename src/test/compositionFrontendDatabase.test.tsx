import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMoveLoadItems } from '@/hooks/useMoveLoadItems';
import { createCompositionDatabase, compositionIds as i, compositionRpc, seedComposition } from './helpers/compositionDatabase';
import { dispatchPlanning } from './helpers/planningDatabase';

vi.hoisted(async () => {
  const { Blob, File } = await import('node:buffer'); vi.stubGlobal('Blob', Blob); vi.stubGlobal('File', File);
});
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), loseReply: false }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: i.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: i.operator } }) }));
let db: PGlite; let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const request = { sourceLoadId: i.load, targetLoadId: i.load2, items: [{ id: i.item, fiscalDocumentId: i.doc }] };
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);
beforeAll(async () => { db = await createCompositionDatabase({ candidate: true }); }, 30_000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  vi.clearAllMocks(); mock.loseReply = false; await seedComposition(db);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mock.rpc.mockImplementation((name: string, args: { _tenant_id: string; _source_load_id: string; _target_load_id: string; _item_ids: string[] }) => ({
    abortSignal: async () => {
      expect(name).toBe('move_load_items_between_loads');
      try {
        const result = await compositionRpc(db, 'select public.move_load_items_between_loads($1,$2,$3,$4) result',
          [args._tenant_id, args._source_load_id, args._target_load_id, args._item_ids]);
        const row = result.rows[0] as { result: unknown };
        return { data: mock.loseReply ? {} : row.result, error: null };
      } catch (error) { return { data: null, error }; }
    },
  }));
});
afterEach(() => { cleanup(); client.clear(); });

describe('real composition hook to captured SQL graph (local, not authenticated HTTP E2E)', () => {
  it('confirms actual full move and database-owned cleanup without any extra table write', async () => {
    const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => {
      const moved = await result.current.moveItems({ ...request, items: [...request.items, { id: i.item2, fiscalDocumentId: i.doc2 }] });
      expect(moved).toMatchObject({ moved: 2, source_removed: true, document_ids: [i.doc, i.doc2] });
    });
    expect(await count(`select count(*) n from loads where id='${i.load}'`)).toBe(0);
    expect(await count(`select total_weight_kg n from loads where id='${i.load2}'`)).toBe(30);
    expect(await count('select count(*) n from driver_settlement_payments')).toBe(0);
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.from).not.toHaveBeenCalled();
  });
  it('passes a real cross-trip rejection to the operator without modifying the planned documents', async () => {
    await dispatchPlanning(db); const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems(request)).rejects.toMatchObject({ code: '23514', outcome: 'rejected' }); });
    expect(await count(`select count(*) n from dispatch_stop_documents where load_id='${i.load}'`)).toBe(2);
    expect(await count(`select count(*) n from load_items where load_id='${i.load}'`)).toBe(2);
  });
  it('does not replay or claim failure when the commit succeeded but its response was incomplete', async () => {
    mock.loseReply = true; const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems(request)).rejects.toMatchObject({ outcome: 'unconfirmed' }); });
    expect(await count(`select count(*) n from load_items where load_id='${i.load2}'`)).toBe(1);
    expect(await count("select count(*) n from entity_audit_log where action='move_items_out'")).toBe(1);
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.from).not.toHaveBeenCalled();
  });
  it('honors membership revoked in the database despite a still-present frontend user', async () => {
    await db.query('update tenant_memberships set active=false where user_id=$1', [i.operator]);
    const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems(request)).rejects.toMatchObject({ code: '42501', outcome: 'rejected' }); });
    expect(await count(`select count(*) n from load_items where load_id='${i.load2}'`)).toBe(0);
  });
  it('rejects a stale selection atomically instead of accepting a partially moved count', async () => {
    const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems({ ...request,
      items: [...request.items, { id: '91000000-0000-4000-8000-000000000099', fiscalDocumentId: null }],
    })).rejects.toMatchObject({ outcome: 'rejected' }); });
    expect(await count(`select count(*) n from load_items where load_id='${i.load2}'`)).toBe(0);
    expect(await count("select count(*) n from entity_audit_log where action='move_items_out'")).toBe(0);
  });
});
