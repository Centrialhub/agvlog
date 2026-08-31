import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ReceivableFinancialDialog} from '@/components/financial/ReceivableFinancialDialog';
import {ReceivableFinancialRecoveryPanel} from '@/components/financial/ReceivableFinancialRecoveryPanel';
import ReceivablePaymentDialog from '@/components/financial/ReceivablePaymentDialog';
import type {Receivable} from '@/hooks/useReceivables';
import {pendingFinancialCommand} from '@/lib/financial/receivableFinancialOutbox';
import {createReceivableFinancialDatabase,createFinancialScenario,financialCommand,financialPayload} from './helpers/receivableFinancialDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),upload:vi.fn(),tenant:'',actor:'',lost:false,delay:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
vi.mock('@/lib/secureUpload',()=>({uploadSecureFile:mock.upload}));
let db:PGlite;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db}=await createReceivableFinancialDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=false;mock.delay=false;mock.release=null;
 await db.exec('begin');client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.from.mockImplementation(()=>{throw new Error('Financial command must not write tables directly');});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(name==='get_receivable_financial_context')data=(await operationRpc(db,'select get_receivable_financial_context($1,$2) result',[args._tenant_id,args._receivable_id])).rows[0].result;
   else if(name==='apply_receivable_financial_command')data=(await operationRpc(db,'select apply_receivable_financial_command($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else throw new Error('Unexpected RPC '+name);
   if(mock.delay&&name==='get_receivable_financial_context'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='apply_receivable_financial_command'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(work,work);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({receivable}:{receivable?:string}){return <QueryClientProvider client={client}><ReceivableFinancialRecoveryPanel/>{receivable?<ReceivableFinancialDialog tenantId={i.tenant} receivableId={receivable} onClose={()=>{}}/>:null}</QueryClientProvider>;}
const set=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
const calls=()=>mock.rpc.mock.calls.filter(([name])=>name==='apply_receivable_financial_command');
async function choose(action='receive'){
 await screen.findByLabelText('Operação financeira');set('Operação financeira',action);set('Motivo da operação','Conferência financeira da operação');
 if(action==='receive'){set('Valor recebido (R$)','10,00');set('Conta bancária','cf600000-0000-4000-8000-000000000001');}
}
async function net(){return (await db.query('select received_amount::float received from receivables')).rows[0];}
describe('financial UI backed by real SQL commands',{timeout:15000},()=>{
 it('requires explicit action and reason, records cents once and invalidates linked modules',async()=>{
  const s=await createFinancialScenario(db);const invalidation=vi.spyOn(client,'invalidateQueries');render(<Story receivable={s.receivable}/>);
  await screen.findByLabelText('Operação financeira');expect(screen.getByRole('button',{name:'Confirmar operação'})).toBeDisabled();await choose();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Pedido confirmado: Registrar recebimento/);
  expect(await net()).toEqual({received:10});expect(calls()).toHaveLength(1);expect(calls()[0][1]._payload.amount_cents).toBe(1000);expect(mock.from).not.toHaveBeenCalled();
  for(const key of ['receivables','client_invoices','closing-reports','bank_transactions'])expect(invalidation.mock.calls.some(([filter])=>filter?.queryKey?.[0]===key)).toBe(true);
 });
 it('recovers a lost reply after remount using the same command without creating another bank entry',async()=>{
  const s=await createFinancialScenario(db);mock.lost=true;const view=render(<Story receivable={s.receivable}/>);await choose();fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText('Resposta perdida após confirmação no banco');
  const request=pendingFinancialCommand(localStorage,i.tenant,i.operator)!.payload.request_id;view.unmount();render(<Story/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar operação financeira'}));await screen.findByText(/Operação recuperada: Registrar recebimento/);
  expect(calls().map(([,args])=>args._payload.request_id)).toEqual([request,request]);expect((await db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:1});expect(await net()).toEqual({received:10});
 });
 it('shows compensating reversals with original history preserved and a reusable open balance',async()=>{
  const s=await createFinancialScenario(db);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);const payment=await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));
  render(<Story receivable={s.receivable}/>);await choose('reverse');set('Recebimento a estornar',payment.payment_id!);fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Pedido confirmado: Estornar recebimento/);
  expect(await net()).toEqual({received:0});expect(within(screen.getByRole('region',{name:'Histórico de recebimentos'})).getByText(/Estornado — original preservado/)).toBeInTheDocument();
  expect((await db.query('select count(*)::int n from receivables_payments')).rows[0]).toEqual({n:1});expect((await db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:2});
 });
 it('hides administrative reversal from an operator',async()=>{
  const s=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,s.receivable));render(<Story receivable={s.receivable}/>);await screen.findByLabelText('Operação financeira');expect(screen.queryByRole('option',{name:'Estornar recebimento'})).not.toBeInTheDocument();
 });
 it('preserves the draft when rejecting stale context and refreshes the backend balance',async()=>{
  const s=await createFinancialScenario(db);render(<Story receivable={s.receivable}/>);await choose();await financialCommand(db,await financialPayload(db,s.receivable));
  fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/O título mudou ou está em uso/);expect(await net()).toEqual({received:10});expect(pendingFinancialCommand(localStorage,i.tenant,i.operator)).toBeNull();expect(screen.getByLabelText('Valor recebido (R$)')).toHaveValue('10,00');
 });
 it('does not transmit when browser persistence fails',async()=>{
  const s=await createFinancialScenario(db);render(<Story receivable={s.receivable}/>);await choose();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Recuperação da operação financeira indisponível/);expect(calls()).toHaveLength(0);expect(await net()).toEqual({received:0});
 });
 it('hides delayed context after tenant change and isolates pending recovery by actor',async()=>{
  const s=await createFinancialScenario(db);mock.delay=true;const view=render(<Story receivable={s.receivable}/>);await waitFor(()=>expect(mock.release).not.toBeNull());mock.tenant=i.otherTenant;view.rerender(<Story receivable={s.receivable}/>);mock.release?.();await transport;expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(calls()).toHaveLength(0);
  view.unmount();mock.tenant=i.tenant;mock.lost=true;client.clear();const next=render(<Story receivable={s.receivable}/>);await choose();fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText('Resposta perdida após confirmação no banco');next.rerender(<Story/>);mock.actor=i.user;next.rerender(<Story/>);expect(screen.queryByRole('button',{name:'Recuperar operação financeira'})).not.toBeInTheDocument();expect(pendingFinancialCommand(localStorage,i.tenant,i.operator)).not.toBeNull();
 });
 it('uploads the optional receipt through the secure path and validates it in SQL',async()=>{
  const s=await createFinancialScenario(db);mock.upload.mockImplementation(async()=>{const path=i.tenant+'/receivable-payments/qa.pdf';await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['receipts',path]);return path;});
  render(<Story receivable={s.receivable}/>);await choose();fireEvent.change(screen.getByLabelText('Comprovante (opcional)'),{target:{files:[new File(['QA'],'qa.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Pedido confirmado: Registrar recebimento/);expect(mock.upload).toHaveBeenCalledTimes(1);expect(calls()[0][1]._payload.attachment_path).toBe(i.tenant+'/receivable-payments/qa.pdf');
 });
 it('rejects fractional cents before sending any command',async()=>{
  const s=await createFinancialScenario(db);render(<Story receivable={s.receivable}/>);await choose();set('Valor recebido (R$)','10,001');fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/até duas casas decimais/);expect(calls()).toHaveLength(0);
 });
 it('reconciles inconsistent invoice status explicitly without another bank transaction',async()=>{
  const s=await createFinancialScenario(db);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));await db.query("update client_invoices set status='generated' where id=$1",[s.invoice]);
  render(<Story receivable={s.receivable}/>);await choose('reconcile');expect(screen.getByText(/O histórico e as projeções divergem/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Pedido confirmado: Conciliar projeções/);
  expect((await db.query('select status from client_invoices where id=$1',[s.invoice])).rows[0]).toEqual({status:'paid'});expect((await db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:1});
 });
 it('routes the existing receivable payment dialog through the same canonical command',async()=>{
  const s=await createFinancialScenario(db);const row=(await db.query<Receivable>('select * from receivables where id=$1',[s.receivable])).rows[0];render(<QueryClientProvider client={client}><ReceivablePaymentDialog receivable={row} open onOpenChange={()=>{}}/></QueryClientProvider>);
  await choose();fireEvent.click(screen.getByRole('button',{name:'Confirmar operação'}));await screen.findByText(/Pedido confirmado: Registrar recebimento/);expect(await net()).toEqual({received:10});expect(calls()).toHaveLength(1);
 });
});
