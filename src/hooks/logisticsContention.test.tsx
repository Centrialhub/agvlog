import { renderHook } from '@testing-library/react';
import { useCreateLoad, useCreateLoadWithNextNumber, useUpdateLoad, useDeleteLoad } from './useLoads';
import { useCreateLoadItem, useUpdateLoadItem, useDeleteLoadItem } from './useLoadItems';
import { useDispatchRoutePlan } from './route-planning/useDispatchRoutePlan';
import { supabase } from '@/integrations/supabase/client';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock feature flags
vi.mock('@/lib/featureFlags', () => ({
  FEATURE_FLAGS: {
    LOGISTICS_CONSOLIDATION_V2: false
  },
  isFeatureEnabled: vi.fn((key) => {
    if (key === 'LOGISTICS_CONSOLIDATION_V2') return FEATURE_FLAGS.LOGISTICS_CONSOLIDATION_V2;
    return false;
  })
}));

// Mock supabase.rpc
const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: { id: 'mock-id' }, error: null, status: 200, statusText: 'OK', count: null } as any);

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('Logistics V2 Contention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  describe('When LOGISTICS_CONSOLIDATION_V2 is false', () => {
    beforeEach(() => {
      FEATURE_FLAGS.LOGISTICS_CONSOLIDATION_V2 = false;
    });

    it('useCreateLoad calls create_load_with_next_number', async () => {
      const { result } = renderHook(() => useCreateLoad(), { wrapper });
      await result.current.mutateAsync({ origin: 'A', destination: 'B' });
      expect(mockRpc).toHaveBeenCalledWith('create_load_with_next_number', expect.any(Object));
      expect(mockRpc).not.toHaveBeenCalledWith('create_load_v1', expect.any(Object));
    });

    it('useCreateLoadItem calls assign_fiscal_documents_to_load if fiscal_document_id is present', async () => {
      const { result } = renderHook(() => useCreateLoadItem(), { wrapper });
      await result.current.mutateAsync({ load_id: 'L1', fiscal_document_id: 'FD1', item_description: 'Test', quantity: 1, pallet_count: 1 });
      expect(mockRpc).toHaveBeenCalledWith('assign_fiscal_documents_to_load', expect.any(Object));
      expect(mockRpc).not.toHaveBeenCalledWith('upsert_load_item_v1', expect.any(Object));
    });

    it('useDeleteLoadItem calls remove_fiscal_documents_from_load', async () => {
      const { result } = renderHook(() => useDeleteLoadItem(), { wrapper });
      await result.current.mutateAsync({ id: 'I1', fiscalDocumentId: 'FD1' });
      expect(mockRpc).toHaveBeenCalledWith('remove_fiscal_documents_from_load', expect.any(Object));
      expect(mockRpc).not.toHaveBeenCalledWith('delete_load_item_v1', expect.any(Object));
    });

    it('useDispatchRoutePlan calls dispatch_planned_route', async () => {
      const { result } = renderHook(() => useDispatchRoutePlan(), { wrapper });
      await result.current.mutateAsync({
        vehicle_id: 'V1',
        driver_id: 'D1',
        planned_start_at: new Date().toISOString(),
        route_name: 'Test',
        load_ids: ['L1'],
        stops: [{ destination: 'B', client_id: 'C1', fiscal_document_ids: ['FD1'] }]
      });
      expect(mockRpc).toHaveBeenCalledWith('dispatch_planned_route', expect.any(Object));
      expect(mockRpc).not.toHaveBeenCalledWith('plan_dispatch_trip_v2', expect.any(Object));
    });
  });

  describe('When LOGISTICS_CONSOLIDATION_V2 is true', () => {
    beforeEach(() => {
      FEATURE_FLAGS.LOGISTICS_CONSOLIDATION_V2 = true;
    });

    it('useCreateLoad calls create_load_v1', async () => {
      const { result } = renderHook(() => useCreateLoad(), { wrapper });
      await result.current.mutateAsync({ origin: 'A', destination: 'B' });
      expect(mockRpc).toHaveBeenCalledWith('create_load_v1', expect.any(Object));
    });

    it('useCreateLoadItem calls upsert_load_item_v1', async () => {
      const { result } = renderHook(() => useCreateLoadItem(), { wrapper });
      await result.current.mutateAsync({ load_id: 'L1', fiscal_document_id: 'FD1', item_description: 'Test', quantity: 1, pallet_count: 1 });
      expect(mockRpc).toHaveBeenCalledWith('upsert_load_item_v1', expect.any(Object));
    });

    it('useDispatchRoutePlan calls plan_dispatch_trip_v2', async () => {
      const { result } = renderHook(() => useDispatchRoutePlan(), { wrapper });
      await result.current.mutateAsync({
        vehicle_id: 'V1',
        driver_id: 'D1',
        planned_start_at: new Date().toISOString(),
        route_name: 'Test',
        load_ids: ['L1'],
        stops: [{ destination: 'B', client_id: 'C1', fiscal_document_ids: ['FD1'] } as any]
      });
      expect(mockRpc).toHaveBeenCalledWith('plan_dispatch_trip_v2', expect.any(Object));
    });
  });
});
