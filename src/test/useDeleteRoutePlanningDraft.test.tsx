import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftConflictError, useDeleteDraft } from '@/hooks/useRoutePlanningDrafts';

const tenant = '12000000-0000-4000-8000-000000000001';
const actor = '12000000-0000-4000-8000-000000000002';
const draft = '12000000-0000-4000-8000-000000000003';
const request = '12000000-0000-4000-8000-000000000004';
const revision = 'b'.repeat(64);

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mock.rpc(...args),
  },
}));

const context = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  tenant_id: tenant,
  actor_id: actor,
  draft_id: draft,
  exists: true,
  can_delete: true,
  status: 'draft',
  revision,
  ...overrides,
});
const result = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  tenant_id: tenant,
  actor_id: actor,
  request_id: request,
  draft_id: draft,
  confirmed: true,
  deleted: true,
  ...overrides,
});

let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe('recoverable route-planning draft deletion', () => {
  it('reads the server revision and sends it in the CAS command', async () => {
    mock.rpc
      .mockResolvedValueOnce({ data: context(), error: null })
      .mockResolvedValueOnce({ data: result(), error: null });
    const { result: hook } = renderHook(useDeleteDraft, { wrapper });

    await act(async () => {
      await expect(hook.current.mutateAsync({ id: draft, requestId: request })).resolves.toMatchObject({ deleted: true });
    });

    expect(mock.rpc).toHaveBeenNthCalledWith(1, 'get_route_planning_draft_delete_context_v1', {
      _tenant_id: tenant,
      _draft_id: draft,
    });
    expect(mock.rpc).toHaveBeenNthCalledWith(2, 'delete_route_planning_draft_v1', {
      _payload: expect.objectContaining({
        tenant_id: tenant,
        actor_id: actor,
        request_id: request,
        draft_id: draft,
        expected_revision: revision,
      }),
    });
  });

  it('retries a network failure with the exact same idempotency payload', async () => {
    mock.rpc
      .mockResolvedValueOnce({ data: context(), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'network unavailable' } })
      .mockResolvedValueOnce({ data: result(), error: null });
    const { result: hook } = renderHook(useDeleteDraft, { wrapper });

    await act(async () => {
      await hook.current.mutateAsync({ id: draft, requestId: request });
    });

    expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[2]);
  });

  it('does not send a delete command for a lifecycle-closed draft', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: context({ can_delete: false, status: 'dispatched' }),
      error: null,
    });
    const { result: hook } = renderHook(useDeleteDraft, { wrapper });

    await act(async () => {
      await expect(hook.current.mutateAsync({ id: draft, requestId: request })).rejects.toBeInstanceOf(DraftConflictError);
    });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a confirmation from another tenant', async () => {
    mock.rpc
      .mockResolvedValueOnce({ data: context(), error: null })
      .mockResolvedValueOnce({ data: result({ tenant_id: '22000000-0000-4000-8000-000000000001' }), error: null });
    const { result: hook } = renderHook(useDeleteDraft, { wrapper });

    await act(async () => {
      await expect(hook.current.mutateAsync({ id: draft, requestId: request })).rejects.toThrow('Confirmação de exclusão incompatível');
    });
  });
});
