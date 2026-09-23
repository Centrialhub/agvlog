import {renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';

const mocks=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/lib/financial/manualTitleCommand',()=>({saveManualTitle:mocks.save}));
import {useCreatePayable} from '@/hooks/usePayables';

it('creates a manual title through the durable command scoped to actor and tenant',async()=>{
  mocks.save.mockResolvedValue({tenant_id:'tenant'});
  const client=new QueryClient();
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>useCreatePayable(),{wrapper});
  await result.current.mutateAsync({supplier_name:'Fornecedor QA',amount:100,status:'pending'});
  expect(mocks.save).toHaveBeenCalledWith('tenant','actor','payable',{supplier_name:'Fornecedor QA',amount:100,status:'pending'},null,null,'');
});
