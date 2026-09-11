import {FinanceRejectedError} from '@/lib/financial/ledgerClient';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {StatementReconciliation} from '@/components/financial/StatementReconciliation';
const mock=vi.hoisted(()=>({options:vi.fn(),context:vi.fn(),reconcile:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readReconciliationOptions:mock.options,readReconciliationContext:mock.context,reconcileBankGroup:mock.reconcile}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),statement=crypto.randomUUID(),account=crypto.randomUUID(),movement=crypto.randomUUID(),entry=crypto.randomUUID();
const key=`finance-reconciliation:${tenant}:${actor}:${statement}`;
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><StatementReconciliation tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();
 mock.options.mockImplementation(async(_tenant:string,_statement:string,kind:string)=>({version:1,tenant_id:tenant,import_id:statement,bank_account_id:account,kind,page:1,page_size:20,total:1,rows:[{id:kind==='movements'?movement:entry,bank_account_id:account,day:'2026-09-09',direction:'out',amount_cents:'50000',description:kind==='movements'?'PIX registrado':'PIX no banco',counterparty:'Motorista',reference:'ABC',source_verified:true}]}));
 mock.context.mockResolvedValue({version:1,tenant_id:tenant,revision:'a'.repeat(32),accounts:[{id:account,name:'Conta operação',bank_name:'Banco',bank_code:'123',branch_number:'001',account_number:'123-4',account_type:'checking'}],
  movements:[{id:movement,tenant_id:tenant,bank_account_id:account,direction:'out',amount_cents:50000,occurred_on:'2026-09-09',description:'PIX registrado',beneficiary_name:'Motorista'}],
  entries:[{id:entry,tenant_id:tenant,bank_account_id:account,amount_cents:-50000,posted_on:'2026-09-09',description:'PIX no banco',counterparty_name:'Motorista',active:true,source_verification:{id:crypto.randomUUID(),outcome:'rows_match'}}],history:[]});
 mock.reconcile.mockImplementation(async command=>({version:1,tenant_id:tenant,request_id:command.request_id,group_id:crypto.randomUUID(),amount_cents:'50000',manual:true,confirmed:true}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function review(){
 fireEvent.click(screen.getByRole('button',{name:'Conciliar lançamentos deste extrato'}));
 await screen.findByText('PIX registrado',{exact:false});
 fireEvent.click(within(screen.getByRole('region',{name:'Lançamentos registrados'})).getByRole('checkbox'));
 fireEvent.click(within(screen.getByRole('region',{name:'Linhas do extrato'})).getByRole('checkbox'));
 fireEvent.change(screen.getByLabelText('Como conferiu a conta no original?'),{target:{value:'Agência e conta conferidas no cabeçalho do original'}});
 fireEvent.change(screen.getByLabelText('Justificativa da conciliação'),{target:{value:'PIX corresponde ao envio registrado para o motorista'}});
 fireEvent.click(screen.getByRole('button',{name:'Conferir seleção e totais'}));await screen.findByRole('button',{name:'Confirmar conciliação manual'});
}
describe('manual statement reconciliation',()=>{
 it('requires an explicit review and preserves the request before sending',async()=>{
  mount();await review();expect(mock.reconcile).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBeNull();
  mock.reconcile.mockImplementationOnce(async command=>{expect(JSON.parse(sessionStorage.getItem(key)!).command.request_id).toBe(command.request_id);return {amount_cents:'50000'};});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar conciliação manual'}));await screen.findByText(/Conciliação manual registrada/);
  expect(mock.context).toHaveBeenCalledWith(tenant,[movement],[entry]);expect(mock.reconcile).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('resumes an uncertain confirmation after remount with the same request and frozen selection',async()=>{
  mock.reconcile.mockRejectedValueOnce(new Error('network response lost'));const first=mount();await review();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar conciliação manual'}));await screen.findByText(/Retome o mesmo pedido preservado/);
  const command=JSON.parse(sessionStorage.getItem(key)!).command;first.unmount();mock.options.mockClear();mount();
  expect(mock.options).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Retomar mesma conciliação'}));await screen.findByText(/Conciliação manual registrada/);
  expect(mock.reconcile.mock.calls.map(([sent])=>sent)).toEqual([command,command]);expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('does not send if recovery storage fails and refuses mismatched totals during review',async()=>{
  const first=mount();await review();const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar conciliação manual'}));expect(await screen.findByText(/Nenhuma confirmação foi enviada/)).toBeInTheDocument();expect(mock.reconcile).not.toHaveBeenCalled();
  storage.mockRestore();first.unmount();mount();const original=await mock.context();mock.context.mockResolvedValue({...original,entries:[{...original.entries[0],amount_cents:-40000}]});
  fireEvent.click(screen.getByRole('button',{name:'Conciliar lançamentos deste extrato'}));await screen.findByText('PIX registrado',{exact:false});
  fireEvent.click(within(screen.getByRole('region',{name:'Lançamentos registrados'})).getByRole('checkbox'));fireEvent.click(within(screen.getByRole('region',{name:'Linhas do extrato'})).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Como conferiu a conta no original?'),{target:{value:'Conta conferida no extrato original'}});fireEvent.change(screen.getByLabelText('Justificativa da conciliação'),{target:{value:'Conferência do pagamento registrado'}});
  fireEvent.click(screen.getByRole('button',{name:'Conferir seleção e totais'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Os totais precisam ser iguais'));expect(mock.reconcile).not.toHaveBeenCalled();
 });
});

it('unlocks first inactive-movement rejection but preserves a previously uncertain concurrency retry',async()=>{mock.reconcile.mockRejectedValueOnce(new FinanceRejectedError('finance_reconciliation_movement_inactive'));const first=mount();await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar conciliação manual'}));await screen.findByText(/Um movimento selecionado foi invalidado/);expect(sessionStorage.getItem(key)).toBeNull();expect(screen.queryByRole('button',{name:'Retomar mesma conciliação'})).not.toBeInTheDocument();first.unmount();mock.reconcile.mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new FinanceRejectedError('finance_dependency_busy'));mount();await review();fireEvent.click(screen.getByRole('button',{name:'Confirmar conciliação manual'}));await screen.findByRole('button',{name:'Retomar mesma conciliação'});const saved=sessionStorage.getItem(key);fireEvent.click(screen.getByRole('button',{name:'Retomar mesma conciliação'}));await screen.findByText(/Outra operação está alterando uma dependência desta conciliação/);expect(sessionStorage.getItem(key)).toBe(saved);expect(screen.getByRole('button',{name:'Retomar mesma conciliação'})).toBeInTheDocument();});
