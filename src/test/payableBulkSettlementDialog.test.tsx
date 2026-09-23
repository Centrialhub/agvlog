import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import {payableBulkStorageKey,type PayableBulkSelection} from '@/lib/financial/payableBulkSettlementContract';

const api=vi.hoisted(()=>({movements:vi.fn(),preview:vi.fn(),apply:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readPayableMovements:api.movements}));
vi.mock('@/lib/financial/payableBulkSettlementClient',()=>({readPayableBulkContext:api.preview,applyPayableBulkSettlement:api.apply,PayableBulkRejectedError:class extends Error{}}));
vi.mock('@/hooks/useFinancialPayments',()=>({PAYMENT_METHODS:['pix'],PAYMENT_METHOD_LABELS:{pix:'PIX'}}));
import {PayableBulkSettlementDialog} from '@/components/financial/PayableBulkSettlementDialog';

const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
const payableA='30000000-0000-4000-8000-000000000001',payableB='30000000-0000-4000-8000-000000000002';
const movement='40000000-0000-4000-8000-000000000001',account='50000000-0000-4000-8000-000000000001';
const titles:PayableBulkSelection[]=[
  {payable_id:payableA,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota A',open_cents:'30000'},
  {payable_id:payableB,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota B',open_cents:'20000'},
];
const option={id:movement,beneficiary_name:'Fornecedor QA',description:'PIX agrupado',occurred_on:'2026-01-15',bank_reference:'PIX-500',bank_account_id:account,account_name:'Banco QA',amount_cents:'50000',remaining_cents:'50000'};
const context={version:1 as const,tenant_id:tenant,actor_id:actor,movement:{...option,receipt_path:null},items:[
  {payable_id:payableA,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota A',status:'approved',driver_id:null,nominal_cents:'30000',paid_cents:'0',remaining_cents:'30000',amount_cents:'30000',eligible:true,issue:null},
  {payable_id:payableB,supplier_id:null,supplier_name:'Fornecedor QA',description:'Nota B',status:'approved',driver_id:null,nominal_cents:'20000',paid_cents:'0',remaining_cents:'20000',amount_cents:'20000',eligible:true,issue:null},
],total_cents:'50000',blockers:[],eligible:true,expected_revision:'a'.repeat(32)};
const command=()=>({version:1 as const,tenant_id:tenant,request_id:crypto.randomUUID(),movement_id:movement,bank_account_id:account,paid_on:'2026-01-15',expected_revision:'a'.repeat(32),items:[{payable_id:payableA,amount_cents:'30000'},{payable_id:payableB,amount_cents:'20000'}],method:'pix' as const,reason:'Pagamento agrupado conferido'});
const result=(request:ReturnType<typeof command>)=>({version:1 as const,tenant_id:tenant,actor_id:actor,request_id:request.request_id,movement_id:movement,bank_account_id:account,paid_on:'2026-01-15',total_cents:'50000',rows:[{payable_id:payableA,payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:'30000'},{payable_id:payableB,payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:'20000'}],bank_confirmation:'not_evaluated' as const,cash_created:false as const,confirmed:true as const});

function mount(props:Partial<React.ComponentProps<typeof PayableBulkSettlementDialog>>={}){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const defaults={tenant,actor,titles,open:true,onOpenChange:vi.fn(),onRecorded:vi.fn()};const merged={...defaults,...props};return {view:render(<QueryClientProvider client={client}><PayableBulkSettlementDialog {...merged}/></QueryClientProvider>),props:merged};}
async function review(){
  fireEvent.click(await screen.findByRole('button',{name:/Fornecedor QA · Banco QA/}));
  fireEvent.change(screen.getByLabelText('Motivo da baixa em lote'),{target:{value:'Pagamento agrupado conferido'}});
  fireEvent.click(screen.getByRole('button',{name:'Revisar baixa em lote'}));
  await screen.findByRole('region',{name:'Revisão da baixa em lote'});
}

beforeEach(()=>{
  localStorage.clear();api.movements.mockReset();api.preview.mockReset();api.apply.mockReset();
  api.movements.mockResolvedValue({version:1,tenant_id:tenant,payable_id:payableA,page:1,total:1,payable_status:'approved',payable_name:'Nota A',remaining_cents:'30000',can_apply:true,rows:[option]});
  api.preview.mockResolvedValue(context);api.apply.mockImplementation(async request=>result(request));
});

it('reviews authoritative account, date and allocations before sending one recoverable command',async()=>{
  const onRecorded=vi.fn(),onOpenChange=vi.fn();mount({onRecorded,onOpenChange});await review();
  expect(api.apply).not.toHaveBeenCalled();expect(screen.getByText(/Banco QA/)).toHaveTextContent(account);expect(screen.getByText('15/01/2026')).toBeInTheDocument();
  expect(api.preview).toHaveBeenCalledWith(tenant,actor,movement,[{payable_id:payableA,amount_cents:'30000'},{payable_id:payableB,amount_cents:'20000'}]);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa em lote'}));
  await waitFor(()=>expect(onRecorded).toHaveBeenCalledTimes(1));
  expect(api.apply.mock.calls[0][0]).toMatchObject({tenant_id:tenant,movement_id:movement,bank_account_id:account,paid_on:'2026-01-15',expected_revision:'a'.repeat(32),items:[{payable_id:payableA,amount_cents:'30000'},{payable_id:payableB,amount_cents:'20000'}]});expect(api.apply.mock.calls[0][1]).toBe(actor);
  expect(localStorage.getItem(payableBulkStorageKey(tenant,actor))).toBeNull();expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('preserves an uncertain request and resumes it even after selected rows disappear',async()=>{
  api.apply.mockRejectedValueOnce(new Error('network'));const first=mount();await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa em lote'}));
  await screen.findByText('Não foi possível confirmar a resposta. O mesmo pedido foi preservado para retomada.');
  const original=api.apply.mock.calls[0][0];expect(localStorage.getItem(payableBulkStorageKey(tenant,actor))).not.toBeNull();first.view.unmount();
  api.apply.mockImplementationOnce(async request=>result(request));mount({titles:[]});expect(screen.getByText('Pedido preservado. Retome exatamente a mesma baixa.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retomar mesma baixa'}));await waitFor(()=>expect(api.apply).toHaveBeenCalledTimes(2));expect(api.apply.mock.calls[1][0]).toEqual(original);
});
it('releases a saved request after a definitive rejection during recovery',async()=>{
  const pendingChanged=vi.fn();api.apply.mockRejectedValueOnce(new Error('network'));const first=mount({onPendingChange:pendingChanged});await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar baixa em lote'}));
  await screen.findByText('Não foi possível confirmar a resposta. O mesmo pedido foi preservado para retomada.');first.view.unmount();
  const rejected=new (await import('@/lib/financial/payableBulkSettlementClient')).PayableBulkRejectedError('finance_payable_bulk_changed');api.apply.mockRejectedValueOnce(rejected);
  mount({onPendingChange:pendingChanged});fireEvent.click(screen.getByRole('button',{name:'Retomar mesma baixa'}));
  expect(await screen.findByText(/Faça uma nova revisão/)).toBeInTheDocument();expect(localStorage.getItem(payableBulkStorageKey(tenant,actor))).toBeNull();expect(screen.queryByRole('button',{name:'Retomar mesma baixa'})).not.toBeInTheDocument();expect(pendingChanged).toHaveBeenCalledWith(false);
});

it('switches to the exact request written by another tab after a storage event',async()=>{
  mount();
  const saved=command(),key=payableBulkStorageKey(tenant,actor);
  localStorage.setItem(key,JSON.stringify({version:1,tenantId:tenant,actorId:actor,payload:{command:saved,context}}));
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key,newValue:localStorage.getItem(key)})));
  expect(await screen.findByText('Pedido preservado. Retome exatamente a mesma baixa.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retomar mesma baixa'}));
  await waitFor(()=>expect(api.apply).toHaveBeenCalledWith(saved,actor));
});
