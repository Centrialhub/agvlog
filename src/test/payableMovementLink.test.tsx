import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({read:vi.fn(),apply:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readPayableMovements:api.read,applyPayableMovement:api.apply,FinanceRejectedError:class extends Error{}}));
vi.mock('@/hooks/useFinancialPayments',()=>({PAYMENT_METHODS:['pix'],PAYMENT_METHOD_LABELS:{pix:'PIX'}}));
import {PayableMovementLink} from '../components/financial/PayableMovementLink';
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',payable='30000000-0000-4000-8000-000000000001';
const row={id:'40000000-0000-4000-8000-000000000001',beneficiary_name:'Fornecedor QA',description:'Envio agrupado',occurred_on:'2026-01-01',bank_reference:'PIX-500',bank_account_id:'50000000-0000-4000-8000-000000000001',account_name:'Banco QA',amount_cents:'50000',remaining_cents:'50000'};
const key=`finance-payable-link:${tenant}:${actor}:${payable}`;
function mount(onRecorded=vi.fn()){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><PayableMovementLink tenant={tenant} actor={actor} payable={payable} onRecorded={onRecorded}/></QueryClientProvider>);}
async function prepare(){
 fireEvent.click(screen.getByRole('button',{name:'Vincular saída já registrada'}));
 fireEvent.click(await screen.findByRole('button',{name:/Fornecedor QA · Banco QA/}));
 fireEvent.change(screen.getByLabelText('Valor para este título (R$)'),{target:{value:'300,00'}});
 fireEvent.change(screen.getByLabelText('Motivo do vínculo'),{target:{value:'Conferência do pagamento agrupado'}});
 fireEvent.click(screen.getByRole('button',{name:'Revisar vínculo'}));
}
beforeEach(()=>{vi.restoreAllMocks();sessionStorage.clear();api.read.mockReset();api.apply.mockReset();api.read.mockResolvedValue({version:1,tenant_id:tenant,payable_id:payable,page:1,total:1,payable_name:'Título fornecedor',payable_status:'approved',remaining_cents:'30000',can_apply:true,rows:[row]});});
describe('link payable to an existing movement',()=>{
 it('requires review and explicit confirmation, preserving the chosen amount and recipient',async()=>{
  api.apply.mockResolvedValue({});const recorded=vi.fn();mount(recorded);await prepare();
  expect(api.apply).not.toHaveBeenCalled();expect(screen.getByText('Destinatário do envio: Fornecedor QA')).toBeInTheDocument();
  expect(screen.getByText(/Parcela para este título:/)).toHaveTextContent('300,00');
  fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo e registrar baixa'}));
  await waitFor(()=>expect(recorded).toHaveBeenCalledTimes(1));
  expect(api.apply.mock.calls[0][0]).toMatchObject({tenant_id:tenant,payable_id:payable,movement_id:row.id,amount_cents:30000,method:'pix'});
  expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('recovers the exact request after uncertain response and remount',async()=>{
  api.apply.mockRejectedValueOnce(new Error('Resposta perdida'));const first=mount();await prepare();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo e registrar baixa'}));
  await screen.findByText('Não foi possível confirmar a resposta. Retome o mesmo pedido.');
  const original=api.apply.mock.calls[0][0];first.unmount();api.apply.mockResolvedValueOnce({});mount();
  expect(screen.getByText('Pedido preservado. Retome com os mesmos dados.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retomar mesma baixa'}));
  await waitFor(()=>expect(api.apply).toHaveBeenCalledTimes(2));expect(api.apply.mock.calls[1][0]).toEqual(original);
 });
 it('does not send without durable storage, and blocks malformed recovered state',async()=>{
  const view=mount();await prepare();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo e registrar baixa'}));
  expect(api.apply).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Nenhum envio foi iniciado');
  spy.mockRestore();view.unmount();sessionStorage.setItem(key,'{invalid');mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível recuperar');
  expect(screen.getByRole('button',{name:'Revisar vínculo'})).toBeDisabled();
 });
});
