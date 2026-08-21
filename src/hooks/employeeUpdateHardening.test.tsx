import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdateEmployee } from './useEmployees';
import { supabase } from '@/integrations/supabase/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock('./useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-123' } }),
}));

describe('useUpdateEmployee Hardening', () => {
  it('deve exigir versão obrigatória no hook', async () => {
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    
    await expect(
      result.current.mutateAsync({ id: 'emp-1', name: 'New Name' } as any)
    ).rejects.toThrow('Versão do registro é obrigatória');
  });

  it('deve tratar erro P0001 como conflito de versão', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({
      error: { code: 'P0001', message: 'Conflict' },
    });

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    
    await expect(
      result.current.mutateAsync({ id: 'emp-1', version: 1, name: 'New Name' })
    ).rejects.toThrow('Conflito de edição');
  });

  it('deve permitir enviar campos como null explicitamente', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    
    await result.current.mutateAsync({ 
      id: 'emp-1', 
      version: 1, 
      phone: null,
      email: null 
    });

    expect(supabase.rpc).toHaveBeenCalledWith('update_employee_v1', expect.objectContaining({
      p_values: { phone: null, email: null }
    }));
  });
});
