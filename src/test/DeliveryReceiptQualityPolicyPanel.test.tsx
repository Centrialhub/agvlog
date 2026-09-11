import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryReceiptQualityPolicyPanel } from '@/components/delivery-receipts/DeliveryReceiptQualityPolicyPanel';
import { BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS } from '@/lib/driver/receiptQualityPolicy';

const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
const clientId='30000000-0000-4000-8000-000000000001',policyId='40000000-0000-4000-8000-000000000001';
const mocks=vi.hoisted(()=>({list:vi.fn(),save:vi.fn(),retire:vi.fn()}));
vi.mock('@/lib/driver/receiptQualityPolicy',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/driver/receiptQualityPolicy')>(),
  listReceiptScanQualityPolicies:mocks.list,saveReceiptScanQualityPolicy:mocks.save,
  retireReceiptScanQualityPolicy:mocks.retire,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  const query={select:()=>query,eq:()=>query,order:()=>Promise.resolve({data:[{id:clientId,company_name:'Cliente Especial'}],error:null})};
  return query;
}}}));

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({version:1,tenant_id:tenant,actor_id:actor,baseline:BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,rows:[{
    id:policyId,tenant_id:tenant,client_id:clientId,client_name:'Cliente Especial',scope:'client',version:2,
    thresholds:{...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,min_source_pixels:3_000_000},is_active:true,
    created_at:'2026-09-10T18:00:00.000Z',created_by:actor,retired_at:null,
  }]});
  mocks.save.mockResolvedValue({id:policyId,version:3,confirmed:true});
});

describe('delivery receipt quality policy panel',()=>{
  it('loads the client rule and saves a new immutable version',async()=>{
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<QueryClientProvider client={queryClient}><DeliveryReceiptQualityPolicyPanel tenantId={tenant} actorId={actor}/></QueryClientProvider>);
    const scope=await screen.findByLabelText('Aplicar a');
    await screen.findByText(/Histórico versionado/);
    fireEvent.change(scope,{target:{value:clientId}});
    await waitFor(()=>expect(screen.getByTestId('active-quality-policy')).toHaveTextContent('versão 2'));
    await waitFor(()=>expect(screen.getByLabelText('Pixels mínimos no original')).toHaveValue(3_000_000));
    fireEvent.change(screen.getByLabelText('Pixels mínimos no original'),{target:{value:'4500000'}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar nova versão'}));
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId:tenant,clientId,expectedActivePolicyId:policyId,
      thresholds:expect.objectContaining({min_source_pixels:4_500_000}),
    })));
  });
});
