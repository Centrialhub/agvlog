import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn(),context:vi.fn(),accounts:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc}}));
vi.mock('@/lib/financial/ledgerClient',()=>({readPayableMovements:api.context}));
vi.mock('@/hooks/useFinancialPayments',()=>({useBankAccounts:api.accounts,PAYMENT_METHODS:['pix'],PAYMENT_METHOD_LABELS:{pix:'PIX'}}));
vi.mock('@/components/financial/PayableApprovalDialog',()=>({PayableApprovalDialog:()=> <p>Conferência de aprovação aberta</p>}));
import {PayableAccountPayment} from '@/components/financial/PayableAccountPayment';
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),payable=crypto.randomUUID(),account=crypto.randomUUID();
function mount(){const done=vi.fn();const view=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayableAccountPayment tenant={tenant} actor={actor} payable={payable} onRecorded={done}/></QueryClientProvider>);return {view,done};}
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,fn:()=>Promise<unknown>)=>fn()}});
 api.accounts.mockReturnValue({data:[{id:account,name:'Banco da empresa',bank_name:'Banco QA'}],isPending:false,isError:false});
 api.context.mockResolvedValue({can_apply:true,remaining_cents:'10000',payable_status:'approved'});
 api.rpc.mockImplementation(async(_name:string,{_payload:c})=>({data:{version:1,tenant_id:tenant,request_id:c.request_id,payable_id:payable,bank_account_id:c.bank_account_id,paid_on:c.paid_on,amount_cents:String(c.amount_cents),movement_id:crypto.randomUUID(),payment_id:crypto.randomUUID(),confirmed:true},error:null}));
});
async function review(){
 await screen.findByText('Saldo em aberto: R$ 100,00');
 fireEvent.change(screen.getByLabelText('Conta de origem'),{target:{value:account}});
 fireEvent.change(screen.getByLabelText('Valor pago (R$)'),{target:{value:'50,00'}});
 fireEvent.change(screen.getByLabelText('Data do pagamento'),{target:{value:'2026-09-01'}});
 fireEvent.change(screen.getByLabelText('Observação do pagamento'),{target:{value:'Pagamento já realizado pelo banco'}});
 fireEvent.click(screen.getByRole('button',{name:'Revisar baixa por conta'}));
}
it('requires a bank account and sends the selected account only after review',async()=>{
 const {done}=mount();await screen.findByText('Saldo em aberto: R$ 100,00');
 fireEvent.click(screen.getByRole('button',{name:'Revisar baixa por conta'}));expect(api.rpc).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('Selecione a conta');
 await review();expect(api.rpc).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa nesta conta'}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(api.rpc).toHaveBeenCalledWith('pay_finance_payable_from_account',{_payload:expect.objectContaining({tenant_id:tenant,payable_id:payable,bank_account_id:account,amount_cents:5000,paid_on:'2026-09-01'})});
});
it('resumes an uncertain payment with the exact same account, amount and request id after reopening',async()=>{
 api.rpc.mockRejectedValueOnce(new Error('Resposta não confirmada'));
 const first=mount();await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa nesta conta'}));
 await screen.findByText('Resposta não confirmada');const original=api.rpc.mock.calls[0][1];first.view.unmount();
 const second=mount();fireEvent.click(await screen.findByRole('button',{name:'Retomar mesma baixa por conta'}));
 await waitFor(()=>expect(second.done).toHaveBeenCalledOnce());expect(api.rpc.mock.calls[1][1]).toEqual(original);
});
it('provides approval from the payment screen instead of silently blocking pending titles',async()=>{
 api.context.mockResolvedValue({can_apply:false,remaining_cents:'10000',payable_status:'pending'});mount();
 fireEvent.click(await screen.findByRole('button',{name:'Conferir aprovação para baixa'}));
 expect(screen.getByText('Conferência de aprovação aberta')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Revisar baixa por conta'})).toBeDisabled();
});
it('allows a new review when a resumed request is definitively rejected after the server checks its outcome',async()=>{
 api.rpc.mockRejectedValueOnce(new Error('Resposta não confirmada'));
 const first=mount();await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa nesta conta'}));
 await screen.findByText('Resposta não confirmada');first.view.unmount();
 api.rpc.mockResolvedValueOnce({data:null,error:{code:'40001',message:'finance_payable_archive_changed'}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Retomar mesma baixa por conta'}));
 await screen.findByText('A conta mudou. Atualize a lista e revise novamente.');
 expect(localStorage.getItem(`agvlog:payable-action:v1:${tenant}:${actor}:${payable}`)).toBeNull();
 expect(screen.getByLabelText('Conta de origem')).toBeInTheDocument();
});
