import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCostCenters } from '@/hooks/useCostCenters';
import {costCenterDeleteError} from '@/lib/financial/costCenterCommand';

const mock = vi.hoisted(() => ({
  tenant: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  rows: [] as Array<{id:string;tenant_id:string;name:string;active:boolean;created_at:string;updated_at:string}>,
  from: vi.fn(), rpc: vi.fn(),
  success: vi.fn(), error: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mock.tenant } }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: mock.success, error: mock.error }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.rows = [];
  mock.rpc.mockResolvedValue({data:{version:1,tenant_id:mock.tenant,actor_id:mock.actor,status:'created',confirmed:true,cost_center:{id:'33333333-3333-4333-8333-333333333333',tenant_id:mock.tenant,name:'Pedágios',active:true,created_at:'2026-09-15T00:00:00Z',updated_at:'2026-09-15T00:00:00Z'}},error:null});
  mock.from.mockImplementation(() => {
    const read = { eq: vi.fn(), order: vi.fn() };
    read.eq.mockReturnValue(read);
    read.order.mockResolvedValue({ data: mock.rows, error: null });
    return {
      select: vi.fn(() => read),
    };
  });
});

function openHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate=vi.spyOn(client,'invalidateQueries');
  const wrapper = ({ children }: {children:ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {...renderHook(() => useCostCenters(), { wrapper }),invalidate};
}

it('persists a new cost center in the active tenant and confirms the returned row', async () => {
  const hook = openHook();
  await waitFor(() => expect(hook.result.current.isFullLoading).toBe(false));

  await act(async () => { await hook.result.current.addCostCenter('  Pedágios  '); });

  expect(mock.rpc).toHaveBeenCalledWith('create_or_reactivate_cost_center_v1',{_tenant_id:mock.tenant,_name:'Pedágios'});
  expect(mock.success).toHaveBeenCalledWith('Centro de custo adicionado com sucesso');
});

it('reports a duplicate name without claiming that the center was created', async () => {
  mock.rpc.mockResolvedValue({data:{version:1,tenant_id:mock.tenant,actor_id:mock.actor,status:'already_active',confirmed:true,cost_center:{id:'33333333-3333-4333-8333-333333333333',tenant_id:mock.tenant,name:'Operacional',active:true,created_at:'2026-09-15T00:00:00Z',updated_at:'2026-09-15T00:00:00Z'}},error:null});
  const hook = openHook();
  await waitFor(() => expect(hook.result.current.isFullLoading).toBe(false));

  await act(async () => { await expect(hook.result.current.addCostCenter('  operacional  ')).rejects.toThrow('Já existe'); });

  expect(mock.success).not.toHaveBeenCalled();
  expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('Já existe um centro de custo'));
  expect(hook.invalidate).toHaveBeenCalledWith({queryKey:['cost_centers']});
  expect(hook.invalidate).toHaveBeenCalledWith({queryKey:['cost_centers_full']});
});

it('reactivates atomically even when the inactive center is missing from the client cache', async () => {
  mock.rows=[];
  mock.rpc.mockResolvedValue({data:{version:1,tenant_id:mock.tenant,actor_id:mock.actor,status:'reactivated',confirmed:true,cost_center:{id:'33333333-3333-4333-8333-333333333333',tenant_id:mock.tenant,name:'Operacional',active:true,created_at:'2026-09-15T00:00:00Z',updated_at:'2026-09-15T00:00:01Z'}},error:null});
  const hook=openHook();
  await waitFor(()=>expect(hook.result.current.isFullLoading).toBe(false));

  await act(async()=>{await hook.result.current.addCostCenter('Operacional');});

  expect(mock.success).toHaveBeenCalledWith('Centro de custo reativado com sucesso');
  expect(mock.rpc).toHaveBeenCalledOnce();
});

it('rejects a confirmation returned for another tenant', async () => {
  mock.rpc.mockResolvedValue({data:{version:1,tenant_id:'99999999-9999-4999-8999-999999999999',actor_id:mock.actor,status:'created',confirmed:true,cost_center:{id:'33333333-3333-4333-8333-333333333333',tenant_id:'99999999-9999-4999-8999-999999999999',name:'Operacional',active:true,created_at:'2026-09-15T00:00:00Z',updated_at:'2026-09-15T00:00:00Z'}},error:null});
  const hook=openHook();
  await waitFor(()=>expect(hook.result.current.isFullLoading).toBe(false));

  await act(async()=>{await expect(hook.result.current.addCostCenter('Operacional')).rejects.toThrow('incompatível');});

  expect(mock.success).not.toHaveBeenCalled();
});

it.each(['23001','23503'])('explains protected deletion for PostgreSQL code %s',(code)=>{
  expect(costCenterDeleteError({code,message:'database detail'})).toBe(
    'Este centro de custo já está vinculado a despesas. Desative-o para preservar o histórico.',
  );
});
