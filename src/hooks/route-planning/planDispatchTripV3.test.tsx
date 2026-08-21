import { renderHook, act } from '@testing-library/react';
import { useDispatchRoutePlan } from './useDispatchRoutePlan';
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

describe('plan_dispatch_trip_v3 Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('calls plan_dispatch_trip_v3 when flag is true', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ 
      data: 'new-trip-id', 
      error: null,
      status: 200,
      statusText: 'OK',
      count: null
    } as any);

    const { result } = renderHook(() => useDispatchRoutePlan(), { wrapper });
    const payload = { 
        driver_id: 'driver-1',
        vehicle_id: 'vehicle-1',
        route_name: 'Route A',
        load_ids: ['load-1'],
        planned_start_at: new Date().toISOString(),
        stops: [
            { destination: 'Stop 1', client_id: 'client-1', original_order: 1, fiscal_document_ids: ['doc-1'] }
        ] as any,
        planning_draft_id: 'draft-key'
    };
    
    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(mockRpc).toHaveBeenCalledWith('plan_dispatch_trip_v3', expect.objectContaining({
      p_tenant_id: 'test-tenant-id',
      p_idempotency_key: 'draft-key',
      p_driver_id: 'driver-1',
      p_vehicle_id: 'vehicle-1',
      p_route_name: 'Route A',
      p_load_ids: ['load-1'],
      p_stops: [
          { destination: 'Stop 1', client_id: 'client-1', stop_order: 1, document_ids: ['doc-1'] }
      ]
    }));
  });

  it('generates idempotency_key if draft_id is missing', async () => {
    const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ 
      data: 'new-trip-id', 
      error: null 
    } as any);

    const { result } = renderHook(() => useDispatchRoutePlan(), { wrapper });
    
    await act(async () => {
      await result.current.mutateAsync({ 
          driver_id: 'd1', vehicle_id: 'v1', route_name: 'r1', 
          load_ids: [], stops: [] 
      } as any);
    });

    const call = (mockRpc.mock.calls as any[]).find(c => c[0] === 'plan_dispatch_trip_v3');
    expect(call[1].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
