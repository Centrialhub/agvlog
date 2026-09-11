import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ManualExpenseWorkspace} from '@/components/financial/ManualExpenseWorkspace';
const mock=vi.hoisted(()=>({record:vi.fn(),options:vi.fn(),upload:vi.fn()}));
vi.mock('@/hooks/useCostCenters',()=>({useCostCenters:()=>({fullData:[{id:'50000000-0000-4000-8000-000000000001',name:'Sede',active:true}]})}));
vi.mock('@/hooks/useClients',()=>({useClients:()=>({data:[],error:null})}));
vi.mock('@/hooks/usePayables',()=>({PAYABLE_CATEGORIES:['other'],PAYABLE_CATEGORY_LABELS:{other:'Outro'}}));
vi.mock('@/hooks/useFinancialPayments',()=>({PAYMENT_METHODS:['pix'],PAYMENT_METHOD_LABELS:{pix:'PIX'},uploadPaymentAttachment:mock.upload}));
vi.mock('@/lib/financial/ledgerClient',()=>({recordManualExpense:mock.record,readManualExpenseMovements:mock.options,FinanceRejectedError:class extends Error{}}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),movement=crypto.randomUUID();
const choice={id:movement,beneficiary_name:'Papelaria',description:'Envio conferido',occurred_on:'2026-01-01',bank_reference:null,bank_account_id:crypto.randomUUID(),account_name:'Conta principal',amount_cents:'50000',remaining_cents:'50000'};
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();mock.options.mockResolvedValue({total:1,rows:[choice]});});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(){return render(<QueryClientProvider client={new QueryClient()}><ManualExpenseWorkspace tenant={tenant} actor={actor} onClose={()=>{}}/></QueryClientProvider>);}
function fill(){for(const [label,value] of [['Descrição','Material da sede'],['Valor (R$)','300,00'],['Motivo do registro','Conferido pelo financeiro']])fireEvent.change(screen.getByLabelText(label),{target:{value}});}
it('reviews existing cash and recovers the identical creation request after a lost response',async()=>{
 mock.record.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({});const view=open();fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'50000000-0000-4000-8000-000000000001'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(await screen.findByRole('radio'));fireEvent.click(screen.getByRole('button',{name:'Revisar despesa'}));
 await screen.findByRole('button',{name:'Confirmar registro da despesa'});expect(mock.record).not.toHaveBeenCalled();expect(screen.getByText(/Nenhuma outra saída será criada/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da despesa'}));await screen.findByRole('alert');const p=mock.record.mock.calls[0][0];expect(p).toMatchObject({movement_id:movement,amount_cents:30000});expect(p).not.toHaveProperty('paid_at');
 expect(p.cost_center_id).toBe('50000000-0000-4000-8000-000000000001');view.unmount();open();expect(screen.getByText('Centro de custo: Sede')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Retomar mesma despesa'}));await waitFor(()=>expect(mock.record).toHaveBeenCalledTimes(2));expect(mock.record.mock.calls[1][0]).toEqual(p);
});
it('blocks before sending when durable recovery is unavailable',async()=>{
 open();fill();fireEvent.click(screen.getByRole('button',{name:'Revisar despesa'}));await screen.findByRole('button',{name:'Confirmar registro da despesa'});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da despesa'}));expect(await screen.findByRole('alert')).toHaveTextContent('despesa não foi enviada');expect(mock.record).not.toHaveBeenCalled();
});
it('retains the uploaded receipt path in the reviewed unpaid obligation',async()=>{
 mock.upload.mockResolvedValue(tenant+'/payable-payments/proof.pdf');mock.record.mockResolvedValue({});open();fill();
 fireEvent.change(screen.getByLabelText('Comprovante (opcional)'),{target:{files:[new File(['pdf'],'proof.pdf',{type:'application/pdf'})]}});fireEvent.click(screen.getByRole('button',{name:'Revisar despesa'}));
 await screen.findByText('Comprovante anexado para validação e preservação.');fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da despesa'}));await waitFor(()=>expect(mock.record).toHaveBeenCalledTimes(1));expect(mock.record.mock.calls[0][0]).toMatchObject({receipt_path:tenant+'/payable-payments/proof.pdf'});expect(mock.record.mock.calls[0][0]).not.toHaveProperty('movement_id');
});
