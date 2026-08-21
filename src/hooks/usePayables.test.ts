import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreatePayable, useUpdatePayable } from './usePayables';
import { supabase } from '@/integrations/supabase/client';

// Mock functions
const mockSingle = vi.fn(() => Promise.resolve({ data: { id: '1' }, error: null }));
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockEq = vi.fn().mockReturnThis();
const mockUpdate = vi.fn(() => ({ eq: mockEq, select: mockSelect }));
const mockInsert = vi.fn(() => ({ select: mockSelect }));

// Correctly mock supabase.from
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn()
  }
}));

vi.mock('./useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1' } })
}));

vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } })
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (config: any) => ({
    mutateAsync: config.mutationFn,
    isPending: false
  }),
  useQuery: vi.fn()
}));

describe('usePayables Hooks Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'payables') {
        return {
          insert: mockInsert,
          update: mockUpdate,
        };
      }
      return {};
    });
  });

  it('creation should always force status pending and ignore protected fields', async () => {
    const { result } = renderHook(() => useCreatePayable());
    
    await result.current.mutateAsync({
      supplier_name: 'Test Supplier',
      amount: 100,
      status: 'paid',
      tenant_id: 'wrong-tenant',
      created_by: 'hacker',
      paid_amount: 999
    } as any);

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      supplier_name: 'Test Supplier',
      amount: 100,
      status: 'pending'
    }));
    
    const payload = mockInsert.mock.calls[0][0] as any;
    expect(payload.tenant_id).toBeUndefined();
    expect(payload.created_by).toBeUndefined();
    expect(payload.paid_amount).toBeUndefined();
  });

  it('update should use allowlist and include tenant_id in filter', async () => {
    const { result } = renderHook(() => useUpdatePayable());
    
    await result.current.mutateAsync({
      id: 'payable-1',
      supplier_name: 'Updated Supplier',
      status: 'approved',
      paid_at: '2026-01-01'
    } as any);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      supplier_name: 'Updated Supplier'
    }));
    
    const patch = mockUpdate.mock.calls[0][0] as any;
    expect(patch.status).toBeUndefined();
    expect(patch.paid_at).toBeUndefined();

    expect(mockEq).toHaveBeenCalledWith('id', 'payable-1');
    expect(mockEq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
  });
});
