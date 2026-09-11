import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ClientInvoiceLifecycleDialog} from '@/components/financial/ClientInvoiceLifecycleDialog';
const ids={tenant:'10000000-0000-4000-8000-000000000001',invoice:'10000000-0000-4000-8000-000000000002',actor:'10000000-0000-4000-8000-000000000003'};
const m=vi.hoisted(()=>({submit:vi.fn(),canCancel:true,settled:4000}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000003'}})}));
vi.mock('@/hooks/useClientInvoiceLifecycle',()=>({useClientInvoiceLifecycle:()=>({query:{data:{invoice_number:'F-100',status:'generated',received_cents:m.settled,open_cents:5000-m.settled,revision:'a'.repeat(32),can_cancel:m.canCancel,can_mark_sent:false,can_reactivate:false,requires_reconciliation:false,history:[]},isPending:false,isFetching:false,error:null,refetch:vi.fn()},submit:m.submit,isPending:false,pending:null,recoveryError:null})}));
beforeEach(()=>{m.submit.mockReset();m.canCancel=true;m.settled=4000;});afterEach(cleanup);
it('permits server-authorized cancellation of a credit-only40 without instructing a cash reversal',async()=>{
 m.submit.mockResolvedValue({action:'cancel'});render(<ClientInvoiceLifecycleDialog tenantId={ids.tenant} invoiceId={ids.invoice} onClose={()=>{}}/>);
 expect(screen.getByText(/Estado:/)).toHaveTextContent(/Liquidado: R\$ 40,00/);expect(screen.getByText(/O total liquidado pode incluir/)).toHaveTextContent('cancelamento está disponível');expect(screen.queryByText(/Estorne os recebimentos/)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Ação da fatura'),{target:{value:'cancel'}});fireEvent.change(screen.getByLabelText('Motivo da ação'),{target:{value:'Cancelar fatura comercial conferida'}});fireEvent.click(screen.getByText('Confirmar ação da fatura'));await waitFor(()=>expect(m.submit).toHaveBeenCalledWith({invoice_id:ids.invoice,expected_revision:'a'.repeat(32),reason:'Cancelar fatura comercial conferida',action:'cancel'}));
});
it('does not infer the cash component of a mixed settled balance or override a cancellation block',()=>{
 m.canCancel=false;m.settled=4500;render(<ClientInvoiceLifecycleDialog tenantId={ids.tenant} invoiceId={ids.invoice} onClose={()=>{}}/>);
 expect(screen.getByText(/Estado:/)).toHaveTextContent(/Liquidado: R\$ 45,00/);expect(screen.getByText(/O total liquidado pode incluir/)).toHaveTextContent('cancelamento está indisponível');expect(screen.queryByRole('option',{name:'Cancelar fatura'})).not.toBeInTheDocument();expect(screen.getByText('Confirmar ação da fatura')).toBeDisabled();expect(screen.queryByText(/Há recebimento líquido|Estorne os recebimentos/)).not.toBeInTheDocument();expect(m.submit).not.toHaveBeenCalled();
});
