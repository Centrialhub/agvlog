import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,it,expect,vi} from 'vitest';
import PayablePaymentDialog from '@/components/financial/PayablePaymentDialog';
import type {Payable} from '@/hooks/usePayables';
const mock=vi.hoisted(()=>({history:vi.fn()}));
vi.mock('@/hooks/useFinancialPayments',()=>({usePayablePayments:mock.history,PAYMENT_METHOD_LABELS:{pix:'PIX'}}));vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));vi.mock('@/components/financial/PayableMovementLink',()=>({PayableMovementLink:()=>null}));vi.mock('@/components/financial/PayableLinkReversal',()=>({PayableLinkReversal:()=> <p>Reversão canônica</p>}));vi.mock('@/components/financial/LegacyPayableAssociation',()=>({LegacyPayableAssociation:()=> <p>Associação de pagamento antigo</p>}));afterEach(cleanup);
it('never offers canonical payment reversal for a legacy association and keeps its paid meaning',()=>{
 mock.history.mockReturnValue({data:{total:3,rows:[{id:'old',amount:500,method:'pix',paid_at:'2026-01-10',link_id:'old-link',link_origin:'legacy_adoption',reversal:{actor_name:'Ana',created_at:'2026-02-02',reason:'Correção de associação'}},{id:'unlinked',amount:100,method:'pix',paid_at:'2026-01-10',link_origin:null},{id:'canonical',amount:300,method:'pix',paid_at:'2026-01-10',link_id:'new-link',link_origin:'canonical'}]},isFetching:false});
 render(<QueryClientProvider client={new QueryClient()}><PayablePaymentDialog payable={{id:'payable',supplier_name:'Fornecedor',amount:900} as Payable} open onOpenChange={()=>{}}/></QueryClientProvider>);expect(screen.getAllByText('Reversão canônica')).toHaveLength(1);expect(screen.getAllByText('Associação de pagamento antigo')).toHaveLength(2);expect(screen.getByText(/pagamento antigo foi preservado/)).toBeInTheDocument();expect(screen.queryByText('Esta baixa não compõe o total pago atual.')).not.toBeInTheDocument();
});
