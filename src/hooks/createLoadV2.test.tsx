import { renderHook, act } from '@testing-library/react';
import { useCreateLoad } from './useLoads';
import { supabase } from '@/integrations/supabase/client';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock feature flags
vi.mock('@/lib/featureFlags', () => ({
  FEATURE_FLAGS: {
    LOGISTICS_CONSOLIDATION_V2: true
  },
  isFeatureEnabled: vi.fn((key) => {
    if (key === 'LOGISTICS_CONSOLIDATION_V2') return FEATURE_FLAGS.LOGISTICS_CONSOLIDATION_V2;
    return false;
  })
}));

// Mock useTenant
vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({
    currentTenant: { id: 'test-tenant-id' },
    isLoading: false
  })
}));

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('create_load_v2 Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('calls create_load_v2 with idempotency_key when flag is true', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ 
      data: 'new-load-id', 
      error: null,
      status: 200,
      statusText: 'OK',
      count: null
    } as any);

    const { result } = renderHook(() => useCreateLoad(), { wrapper });
    const payload = { 
        origin: 'A', 
        destination: 'B',
        idempotency_key: 'test-key'
    };
    
    await act(async () => {
      await result.current.mutateAsync(payload as any);
    });

    expect(mockRpc).toHaveBeenCalledWith('create_load_v2', expect.objectContaining({
      p_tenant_id: 'test-tenant-id',
      p_idempotency_key: 'test-key',
      p_origin: 'A',
      p_destination: 'B'
    }));
  });

  it('generates random idempotency_key if not provided', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ 
      data: 'new-load-id', 
      error: null,
      status: 200,
      statusText: 'OK',
      count: null
    } as any);

    const { result } = renderHook(() => useCreateLoad(), { wrapper });
    
    await act(async () => {
      await result.current.mutateAsync({ origin: 'A' } as any);
    });

    const call = (mockRpc.mock.calls as any[]).find(c => c[0] === 'create_load_v2');
    expect(call).toBeDefined();
    expect(call[1].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
