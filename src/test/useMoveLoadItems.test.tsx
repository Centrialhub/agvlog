import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMoveLoadItems } from '@/hooks/useMoveLoadItems';
import { COMPOSITION_QUERY_KEYS, compositionMutationError, isConfirmedItemMove } from '@/lib/loads/compositionMutation';
import { TRIP_LOAD_QUERY_KEYS } from '@/lib/tripMutation';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), tenant: { id: 'tenant' } as { id: string } | null,
  user: { id: 'actor' } as { id: string } | null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: mock.tenant }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mock.user }) }));
const request = { sourceLoadId: 'source', targetLoadId: 'target', items: [{ id: 'item', fiscalDocumentId: 'doc' }] };
const confirmed = { moved: 1, source_load_id: 'source', target_load_id: 'target', document_ids: ['doc'], source_removed: false };
let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); mock.tenant = { id: 'tenant' }; mock.user = { id: 'actor' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } } });
  mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: confirmed, error: null }) }));
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });

describe('confirmed composition client', () => {
  it('uses the authenticated tenant and sends one complete request with no follow-up write', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries'); const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { expect(await result.current.moveItems(request)).toEqual(confirmed); });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('move_load_items_between_loads', {
      _tenant_id: 'tenant', _source_load_id: 'source', _target_load_id: 'target', _item_ids: ['item'],
    });
    expect(mock.from).not.toHaveBeenCalled();
    for (const key of [...TRIP_LOAD_QUERY_KEYS, ...COMPOSITION_QUERY_KEYS]) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  });
  it.each([null, {}, { moved: 1 }, { ...confirmed, moved: 0 }, { ...confirmed, moved: 2 },
    { ...confirmed, source_load_id: 'other' }, { ...confirmed, target_load_id: 'other' },
    { ...confirmed, source_removed: null }, { ...confirmed, document_ids: ['wrong'] },
    { ...confirmed, document_ids: ['doc', 'doc'] }, [confirmed]])('does not invent success from %j', async data => {
    mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data, error: null }) }));
    const invalidate = vi.spyOn(client, 'invalidateQueries'); const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems(request)).rejects.toMatchObject({ outcome: 'unconfirmed' }); });
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(mock.from).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['driver_stops'] }); expect(result.current.isPending).toBe(false);
  });
  it('accepts manual items and repeated rows of a single document only with the matching complete result', () => {
    expect(isConfirmedItemMove({ ...confirmed, document_ids: [] }, { ...request, items: [{ id: 'item', fiscalDocumentId: null }] })).toBe(true);
    expect(isConfirmedItemMove({ ...confirmed, moved: 2 }, { ...request, items: [...request.items, { id: 'item2', fiscalDocumentId: 'doc' }] })).toBe(true);
  });
  it('preserves SQL rejection codes, refreshes both apps and never retries automatically', async () => {
    mock.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { code: '40001', message: 'composition_concurrent_change' } }) }));
    const invalidate = vi.spyOn(client, 'invalidateQueries'); const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { await expect(result.current.moveItems(request)).rejects.toMatchObject({ code: '40001', outcome: 'rejected' }); });
    expect(mock.rpc).toHaveBeenCalledTimes(1); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dispatch_trips'] });
  });
  it('rejects a second synchronous submission while the first request is pending', async () => {
    let release!: (value: unknown) => void;
    mock.rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { release = resolve; }) }));
    const { result } = renderHook(useMoveLoadItems, { wrapper }); let first!: ReturnType<typeof result.current.moveItems>;
    act(() => { first = result.current.moveItems(request); });
    await expect(result.current.moveItems(request)).rejects.toThrow('Aguarde'); expect(mock.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { release({ data: confirmed, error: null }); await first; });
  });
  it.each(['tenant', 'actor'])('does not report success after a %s change in flight', async scope => {
    let release!: (value: unknown) => void;
    mock.rpc.mockImplementation(() => ({ abortSignal: () => new Promise(resolve => { release = resolve; }) }));
    const { result, rerender } = renderHook(useMoveLoadItems, { wrapper }); let first!: ReturnType<typeof result.current.moveItems>;
    act(() => { first = result.current.moveItems(request); });
    if (scope === 'tenant') mock.tenant = { id: 'other' }; else mock.user = { id: 'other' }; rerender();
    await act(async () => { release({ data: confirmed, error: null }); await expect(first).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' }); });
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('checks context again after cache refresh, not just after the server response', async () => {
    let release!: () => void;
    vi.spyOn(client, 'invalidateQueries').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { result, rerender } = renderHook(useMoveLoadItems, { wrapper }); let first!: ReturnType<typeof result.current.moveItems>;
    act(() => { first = result.current.moveItems(request); }); await waitFor(() => expect(release).toBeTypeOf('function'));
    mock.tenant = { id: 'other' }; rerender();
    await act(async () => { release(); await expect(first).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' }); });
  });
  it('does not mask a confirmed commit when refreshing a cache fails', async () => {
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('Read unavailable'));
    const { result } = renderHook(useMoveLoadItems, { wrapper });
    await act(async () => { expect(await result.current.moveItems(request)).toEqual(confirmed); });
  });
  it('bounds a hanging transport and treats abort as unconfirmed, not a rollback', async () => {
    vi.useFakeTimers();
    mock.rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }) }));
    const { result } = renderHook(useMoveLoadItems, { wrapper }); let first!: Promise<unknown>;
    act(() => { first = result.current.moveItems(request).catch(error => error); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(await first).toMatchObject({ outcome: 'unconfirmed' }); expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });
  it.each(['no-tenant', 'no-user', 'same-load', 'empty', 'duplicate'])('rejects invalid input without transport: %s', async scenario => {
    if (scenario === 'no-tenant') mock.tenant = null; if (scenario === 'no-user') mock.user = null;
    const input = { ...request };
    if (scenario === 'same-load') input.targetLoadId = input.sourceLoadId;
    if (scenario === 'empty') input.items = []; if (scenario === 'duplicate') input.items = [...request.items, ...request.items];
    const { result } = renderHook(useMoveLoadItems, { wrapper });
    await expect(result.current.moveItems(input)).rejects.toThrow(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('gives actionable replanning guidance and keeps transaction_resolution_unknown uncertain', () => {
    expect(compositionMutationError({ code: '23514', message: 'composition_requires_replanning' }).message).toContain('replanejamento explícito');
    expect(compositionMutationError({ code: '40003', message: 'statement_completion_unknown' }).outcome).toBe('unconfirmed');
  });
});
