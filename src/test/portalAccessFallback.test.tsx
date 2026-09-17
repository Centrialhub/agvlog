import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientPortalAccess } from '@/hooks/portal/useClientPortalAccess';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-a' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
}));

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('portal access compatibility fallback', () => {
  it('does not downgrade an authorization failure to the legacy RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const { result } = renderHook(() => useClientPortalAccess(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_user_client_access_detailed',
    ]);
  });

  it('uses the legacy RPC only when the detailed RPC is absent', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [{ client_id: 'client-a' }], error: null });

    const { result } = renderHook(() => useClientPortalAccess(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ client_id: 'client-a' }]);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_user_client_access_detailed',
      'get_user_client_access',
    ]);
  });
});
