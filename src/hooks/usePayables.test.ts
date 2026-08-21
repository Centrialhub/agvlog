import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreatePayable, useUpdatePayable } from './usePayables';
import { supabase } from '@/integrations/supabase/client';

// Mocks
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: '1', status: 'pending' }, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: { id: '1', supplier_name: 'Updated' }, error: null }))
            }))
          }))
        }))
      }))
    }))
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
  it('creation should always force status pending and ignore protected fields', async () => {
    const { result } = renderHook(() => useCreatePayable());
    
    await result.current.mutateAsync({
      supplier_name: 'Test Supplier',
      amount: 100,
      status: 'paid', // Should be ignored
      tenant_id: 'wrong-tenant', // Should be ignored
      created_by: 'hacker', // Should be ignored
      paid_amount: 999 // Should be ignored
    } as any);

    const insertMock = (supabase.from as any)().insert;
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      supplier_name: 'Test Supplier',
      amount: 100,
      status: 'pending'
    }));
    
    const payload = insertMock.mock.calls[0][0];
    expect(payload.tenant_id).toBeUndefined();
    expect(payload.created_by).toBeUndefined();
    expect(payload.paid_amount).toBeUndefined();
  });

  it('update should use allowlist and include tenant_id in filter', async () => {
    const { result } = renderHook(() => useUpdatePayable());
    
    await result.current.mutateAsync({
      id: 'payable-1',
      supplier_name: 'Updated Supplier',
      status: 'approved', // Should be ignored
      paid_at: '2026-01-01' // Should be ignored
    } as any);

    const fromMock = (supabase.from as any);
    const updateMock = fromMock().update;
    const eqMock = fromMock().update().eq;

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      supplier_name: 'Updated Supplier'
    }));
    
    const patch = updateMock.mock.calls[0][0];
    expect(patch.status).toBeUndefined();
    expect(patch.paid_at).toBeUndefined();

    // Verify tenant_id in filter
    expect(eqMock).toHaveBeenCalledWith('tenant_id', 'tenant-1');
  });
});
