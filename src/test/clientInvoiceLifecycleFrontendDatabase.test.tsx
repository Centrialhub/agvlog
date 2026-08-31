import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ClientInvoiceLifecycleDialog} from '@/components/financial/ClientInvoiceLifecycleDialog';
import {ClosingInvoiceCreationDialog} from '@/components/financial/ClosingInvoiceCreationDialog';
import {ClientInvoiceRecoveryPanel} from '@/components/financial/ClientInvoiceRecoveryPanel';
import {NewInvoiceWizard} from '@/components/financial/NewInvoiceWizard';
import ClientInvoices from '@/pages/ClientInvoices';
import type {Client} from '@/hooks/useClients';
import {pendingInvoiceCommand} from '@/lib/financial/clientInvoiceOutbox';
import {createInvoiceLifecycleDatabase,createInvoiceScenario,invoiceCommand,invoiceActionPayload,manualInvoiceDraft} from './helpers/clientInvoiceLifecycleDatabase';
import {createClosingWithClient,closingAction,closingActionPayload} from './helpers/closingLifecycleDatabase';
import {financialCommand,financialPayload} from './helpers/receivableFinancialDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',lost:false,delay:false,release:null as null|(()=>void),clients:[] as Client[],ctes:[] as Array<Record<string,unknown>>,sourceError:null as Error|null}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useClients',()=>({useClients:()=>({data:mock.clients})}));
vi.mock('@/hooks/useCompanyProfile',()=>({useCompanyProfile:()=>({data:null})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock('@/hooks/useClientInvoices',async()=>{const actual=await vi.importActual<typeof import('@/hooks/useClientInvoices')>('@/hooks/useClientInvoices');return {...actual,
 useEligibleCtes:()=>({data:mock.ctes,isFetching:false,error:mock.sourceError,refetch:vi.fn()}),useEligibleNfse:()=>({data:[],isFetching:false,error:null,refetch:vi.fn()})};});
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db}=await createInvoiceLifecycleDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=false;mock.delay=false;mock.release=null;mock.ctes=[];mock.sourceError=null;
 await db.exec('begin');const draft=await manualInvoiceDraft(db);mock.clients=[{id:draft.client_id,company_name:'Cliente QA'} as Client];
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=vi.fn(()=>false);Element.prototype.setPointerCapture=vi.fn();Element.prototype.releasePointerCapture=vi.fn();
 mock.from.mockImplementation(()=>{throw new Error('Invoice command must not write tables directly');});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(name==='get_client_invoice_action_context')data=(await operationRpc(db,'select get_client_invoice_action_context($1,$2) result',[args._tenant_id,args._invoice_id])).rows[0].result;
   else if(name==='get_client_invoice_creation_context')data=(await operationRpc(db,'select get_client_invoice_creation_context($1,$2,$3::jsonb) result',[args._tenant_id,args._report_id,args._draft===null?null:JSON.stringify(args._draft)])).rows[0].result;
   else if(name==='list_client_invoice_financials')data=(await operationRpc(db,'select list_client_invoice_financials($1) result',[args._tenant_id])).rows[0].result;
   else if(name==='apply_client_invoice_command')data=(await operationRpc(db,'select apply_client_invoice_command($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else throw new Error('Unexpected RPC '+name);
   if(mock.delay&&name==='get_client_invoice_action_context'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='apply_client_invoice_command'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(work,work);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({invoice,report,wizard,onGenerated=()=>{}}:{invoice?:string;report?:string;wizard?:boolean;onGenerated?:(id:string)=>void}){return <QueryClientProvider client={client}><ClientInvoiceRecoveryPanel/>{invoice?<ClientInvoiceLifecycleDialog tenantId={i.tenant} invoiceId={invoice} onClose={()=>{}}/>:null}{report?<ClosingInvoiceCreationDialog tenantId={i.tenant} reportId={report} onClose={()=>{}}/>:null}{wizard?<NewInvoiceWizard open clients={mock.clients} onClose={()=>{}} onGenerated={onGenerated}/>:null}</QueryClientProvider>;}
const set=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
const calls=()=>mock.rpc.mock.calls.filter(([name])=>name==='apply_client_invoice_command');
const admin=async()=>db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
const bank=async()=>db.query('insert into bank_accounts(id,tenant_id,name) values($1,$2,$3)',['cf600000-0000-4000-8000-000000000001',i.tenant,'Banco QA']);
async function choose(action:string){await screen.findByLabelText('Ação da fatura');set('Ação da fatura',action);set('Motivo da ação','Conferência financeira QA');if(action==='mark_sent'){set('Destinatário informado','Destinatário QA');set('Canal informado','manual');}}
async function report(){const id=(await createClosingWithClient(db)).report.id;await closingAction(db,await closingActionPayload(db,id));return id;}
async function wizardStart(){fireEvent.keyDown(screen.getByRole('combobox',{name:'Cliente *'}),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:'Cliente QA'}));fireEvent.click(screen.getByRole('button',{name:'Avançar'}));}
async function manualPreview(){await wizardStart();fireEvent.mouseDown(screen.getByRole('tab',{name:/Serviços avulsos/}),{button:0});fireEvent.click(screen.getByRole('button',{name:'Adicionar serviço avulso'}));set('Descrição','Serviço de teste');set('Bruto','100');set('Líquido','100');fireEvent.click(screen.getByRole('button',{name:'Ver prévia'}));await screen.findByText('Nova Fatura — Etapa 3 de 4');fireEvent.click(screen.getByRole('button',{name:'Avançar'}));}
describe('invoice UI integrated with the candidate SQL',{timeout:15000},()=>{
 it('requires a reason and creates the closing invoice and receivable once',async()=>{
  const id=await report(),invalidation=vi.spyOn(client,'invalidateQueries');render(<Story report={id}/>);await screen.findByLabelText('Motivo do faturamento');expect(screen.getByRole('button',{name:'Confirmar faturamento'})).toBeDisabled();set('Motivo do faturamento','Faturamento conferido');fireEvent.click(screen.getByRole('button',{name:'Confirmar faturamento'}));await screen.findByText(/Um único título foi criado/);
  expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:1});expect(calls()).toHaveLength(1);expect(mock.from).not.toHaveBeenCalled();for(const key of ['receivables','client_invoices','closing-reports','eligible_ctes'])expect(invalidation.mock.calls.some(([filter])=>filter?.queryKey?.[0]===key)).toBe(true);
 });
 it('recovers generation after a lost reply and remount using the original request',async()=>{
  const id=await report();mock.lost=true;const view=render(<Story report={id}/>);await screen.findByLabelText('Motivo do faturamento');set('Motivo do faturamento','Faturamento conferido');fireEvent.click(screen.getByRole('button',{name:'Confirmar faturamento'}));await screen.findByText('Resposta perdida após confirmação no banco');const request=pendingInvoiceCommand(localStorage,i.tenant,i.operator)!.payload.request_id;
  view.unmount();render(<Story/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar pedido de fatura'}));await screen.findByText(/Pedido recuperado: Faturar fechamento/);expect(calls().map(([,args])=>args._payload.request_id)).toEqual([request,request]);expect((await db.query('select count(*)::int n from receivables')).rows[0]).toEqual({n:1});
 });
 it('cancels and reactivates with the same invoice and preserved closing claims',async()=>{
  const s=await createInvoiceScenario(db);await admin();render(<Story invoice={s.invoice}/>);await choose('cancel');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação da fatura'}));await screen.findByText(/Pedido confirmado: Cancelar fatura/);await choose('reactivate');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação da fatura'}));await screen.findByText(/Pedido confirmado: Reativar fatura/);
  expect((await db.query('select status from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'invoiced'});expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is not null')).rows[0]).toEqual({n:3});
 });
 it('records a send without changing paid status or inventing another receipt',async()=>{
  const s=await createInvoiceScenario(db);await bank();await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));render(<Story invoice={s.invoice}/>);await choose('mark_sent');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação da fatura'}));await screen.findByText(/Pedido confirmado: Registrar envio/);
  expect((await db.query('select status from client_invoices where id=$1',[s.invoice])).rows[0]).toEqual({status:'paid'});expect((await db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:1});
 });
 it('does not offer cancellation to an operator',async()=>{const s=await createInvoiceScenario(db);render(<Story invoice={s.invoice}/>);await screen.findByLabelText('Ação da fatura');expect(screen.queryByRole('option',{name:'Cancelar fatura'})).not.toBeInTheDocument();});
 it('preserves the entered reason on stale context and keeps the invoice active',async()=>{
  const s=await createInvoiceScenario(db);await admin();render(<Story invoice={s.invoice}/>);await choose('cancel');await invoiceCommand(db,{...await invoiceActionPayload(db,s.invoice,'mark_sent'),channel:'manual',sent_to:'QA'});fireEvent.click(screen.getByRole('button',{name:'Confirmar ação da fatura'}));await screen.findByText(/A fatura ou sua origem mudou/);expect(screen.getByLabelText('Motivo da ação')).toHaveValue('Conferência financeira QA');expect(pendingInvoiceCommand(localStorage,i.tenant,i.operator)).toBeNull();
 });
 it('sends nothing when durable storage is unavailable',async()=>{
  const s=await createInvoiceScenario(db);await admin();render(<Story invoice={s.invoice}/>);await choose('cancel');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});fireEvent.click(screen.getByRole('button',{name:'Confirmar ação da fatura'}));await screen.findByText(/Recuperação da operação de fatura indisponível/);expect(calls()).toHaveLength(0);
 });
 it('hides a delayed response after tenant change',async()=>{const s=await createInvoiceScenario(db);mock.delay=true;const view=render(<Story invoice={s.invoice}/>);await waitFor(()=>expect(mock.release).not.toBeNull());mock.tenant=i.otherTenant;view.rerender(<Story invoice={s.invoice}/>);mock.release?.();await transport;expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(calls()).toHaveLength(0);});
 it('creates a manual service invoice from a server-checked frozen preview',async()=>{
  const generated=vi.fn();render(<Story wizard onGenerated={generated}/>);await manualPreview();expect(screen.getByRole('button',{name:'Gerar fatura'})).toBeDisabled();set('Motivo do faturamento','Serviço conferido');fireEvent.click(screen.getByRole('button',{name:'Gerar fatura'}));await waitFor(()=>expect(generated).toHaveBeenCalledTimes(1));expect((await db.query('select amount::float amount from receivables')).rows[0]).toEqual({amount:100});expect(calls()[0][1]._payload.draft.charges).toHaveLength(1);
 });
 it('preserves a full wizard draft for recovery after generation acknowledgement is lost',async()=>{
  mock.lost=true;const view=render(<Story wizard/>);await manualPreview();set('Motivo do faturamento','Serviço conferido');fireEvent.click(screen.getByRole('button',{name:'Gerar fatura'}));await screen.findByText(/Falha ao gerar fatura: Resposta perdida/);const original=pendingInvoiceCommand(localStorage,i.tenant,i.operator)!.payload;view.unmount();render(<Story/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar pedido de fatura'}));await screen.findByText(/Pedido recuperado: Gerar fatura/);expect(calls()[1][1]._payload).toEqual(original);expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:1});
 });
 it('does not silently drop a selected source that disappears before preview',async()=>{
  mock.ctes=[{id:'ce200000-0000-4000-8000-000000000001',cte_number:'QA',freight_value:100,fiscal_document_ids:[]}];const view=render(<Story wizard/>);await wizardStart();fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar CT-e QA'}));mock.ctes=[];view.rerender(<Story wizard/>);fireEvent.click(screen.getByRole('button',{name:'Ver prévia'}));await screen.findByText(/Uma origem selecionada não está mais disponível/);expect(calls()).toHaveLength(0);expect(mock.rpc.mock.calls.some(([name])=>name==='get_client_invoice_creation_context')).toBe(false);
 });
 it('blocks preview on source query errors instead of displaying an empty success',async()=>{mock.sourceError=new Error('Falha controlada');render(<Story wizard/>);await wizardStart();expect(screen.getByText(/Falha na consulta de origens/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Ver prévia'})).toBeDisabled();expect(calls()).toHaveLength(0);});
 it('displays net received and remaining balances for a partially received invoice',async()=>{
  const s=await createInvoiceScenario(db);await bank();await financialCommand(db,await financialPayload(db,s.receivable));render(<QueryClientProvider client={client}><ClientInvoices/></QueryClientProvider>);await screen.findByRole('button',{name:'Ações da fatura'});
  expect(within(screen.getByText('Em aberto').parentElement!).getByText(/230,00/)).toBeInTheDocument();expect(within(screen.getByText('Recebido líquido').parentElement!).getByText(/10,00/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Recebimentos e estornos'})).toBeInTheDocument();
 });
});
