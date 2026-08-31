import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ClosingLifecycleDialog} from '@/components/closingReports/ClosingLifecycleDialog';
import {ClosingLifecycleRecoveryPanel} from '@/components/closingReports/ClosingLifecycleRecoveryPanel';
import {pendingClosingAction} from '@/lib/closingReports/closingLifecycleOutbox';
import {createClosingLifecycleDatabase,closingAction,closingActionPayload,createClosingWithClient} from './helpers/closingLifecycleDatabase';
import {closingDraftPayload,createClosingDraft} from './helpers/closingDraftDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',lost:false,delay:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db}=await createClosingLifecycleDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=false;mock.delay=false;mock.release=null;
 await db.exec('begin');client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.from.mockImplementation(()=>{throw new Error('Lifecycle must not write tables directly');});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(name==='get_closing_report_action_context')data=(await operationRpc(db,'select get_closing_report_action_context($1,$2) result',[args._tenant_id,args._report_id])).rows[0].result;
   else if(name==='apply_closing_report_action')data=(await operationRpc(db,'select apply_closing_report_action($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else throw new Error('Unexpected RPC '+name);
   if(mock.delay&&name==='get_closing_report_action_context'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='apply_closing_report_action'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(work,work);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({report}:{report?:string}){return <QueryClientProvider client={client}><ClosingLifecycleRecoveryPanel/>{report?<ClosingLifecycleDialog tenantId={i.tenant} reportId={report} onClose={()=>{}}/>:null}</QueryClientProvider>;}
const set=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
const draft=async()=>createClosingDraft(db,await closingDraftPayload(db));
async function choose(action:string){await screen.findByLabelText('Ação desejada');set('Ação desejada',action);set('Motivo da ação','Conferência da operação');}
async function stored(report:string){return (await db.query('select status,lifecycle_revision::int revision from closing_reports where id=$1',[report])).rows[0];}
async function claims(){return (await db.query('select count(*)::int n from closing_report_charge_claims where released_at is null')).rows[0];}
describe('closing lifecycle UI with real SQL transitions',{timeout:15000},()=>{
 it('requires an explicit action and reason, closes once and keeps all writes in the audited RPC',async()=>{
  const r=await draft();render(<Story report={r.report.id}/>);await screen.findByLabelText('Ação desejada');
  expect(screen.getByRole('button',{name:'Confirmar ação'})).toBeDisabled();set('Ação desejada','close');expect(screen.getByRole('button',{name:'Confirmar ação'})).toBeDisabled();
  set('Motivo da ação','Conferência da operação');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Pedido confirmado: Fechar relatório/);
  expect(await stored(r.report.id)).toEqual({status:'closed',revision:1});expect(await claims()).toEqual({n:3});expect(mock.from).not.toHaveBeenCalled();
  expect(pendingClosingAction(localStorage,i.tenant,i.operator)).toBeNull();expect(mock.rpc.mock.calls.filter(([name])=>name==='apply_closing_report_action')).toHaveLength(1);
 });
 it('recovers a lost acknowledgement after remount without repeating the transition or audit',async()=>{
  const r=await draft();mock.lost=true;const view=render(<Story report={r.report.id}/>);await choose('close');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));
  await screen.findByText('Resposta perdida após confirmação no banco');expect(await stored(r.report.id)).toEqual({status:'closed',revision:1});
  const request=pendingClosingAction(localStorage,i.tenant,i.operator)!.payload.request_id;view.unmount();render(<Story/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar transição'}));await screen.findByText(/Transição recuperada: Fechar relatório/);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='apply_closing_report_action').map(([,args])=>args._payload.request_id)).toEqual([request,request]);
  expect((await db.query("select count(*)::int n from closing_report_history where action='lifecycle_close'")).rows[0]).toEqual({n:1});expect(await claims()).toEqual({n:3});
 });
 it('rejects a stale revision, clears the definitely rejected request and refreshes the current state',async()=>{
  const r=await draft();render(<Story report={r.report.id}/>);await choose('cancel');await closingAction(db,await closingActionPayload(db,r.report.id));
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/O fechamento mudou ou está em uso/);
  expect(pendingClosingAction(localStorage,i.tenant,i.operator)).toBeNull();expect(await stored(r.report.id)).toEqual({status:'closed',revision:1});
  await screen.findByText(/revisão 1/);
 });
 it('reports an already-reserved delivery without changing the second report',async()=>{
  const first=await draft();const second=await createClosingDraft(db,{...await closingDraftPayload(db),request_id:'cf000000-0000-4000-8000-000000000002'});
  await closingAction(db,await closingActionPayload(db,first.report.id));render(<Story report={second.report.id}/>);await choose('close');
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Esta nota\/tentativa já está reservada ou faturada/);
  expect(await stored(second.report.id)).toEqual({status:'draft',revision:0});expect(await claims()).toEqual({n:3});
 });
 it('cancels then allows only an administrator to reopen, preserving released claim history',async()=>{
  const r=await draft();await closingAction(db,await closingActionPayload(db,r.report.id));const view=render(<Story report={r.report.id}/>);await choose('cancel');
  expect(screen.queryByRole('option',{name:'Reabrir para conferência'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Pedido confirmado: Cancelar fechamento/);expect(await claims()).toEqual({n:0});
  view.unmount();await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);client.clear();render(<Story report={r.report.id}/>);
  await choose('reopen');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Pedido confirmado: Reabrir para conferência/);
  expect(await stored(r.report.id)).toEqual({status:'reviewing',revision:3});expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is not null')).rows[0]).toEqual({n:3});
 });
 it('does not expose cancellation or reopening when a canonical invoice exists',async()=>{
  const r=await createClosingWithClient(db);await closingAction(db,await closingActionPayload(db,r.report.id));await operationRpc(db,'select generate_client_invoice_from_closing($1)',[r.report.id]);
  render(<Story report={r.report.id}/>);await screen.findByText(/Há fatura ou recebimento vinculado/);
  expect(screen.queryByRole('option',{name:'Cancelar fechamento'})).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:'Reabrir para conferência'})).not.toBeInTheDocument();
 });
 it('does not send a command when durable browser storage fails',async()=>{
  const r=await draft();render(<Story report={r.report.id}/>);await choose('close');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota exceeded');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Recuperação da transição indisponível/);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='apply_closing_report_action')).toHaveLength(0);expect(await stored(r.report.id)).toEqual({status:'draft',revision:0});
 });
 it('hides delayed context immediately when the tenant changes',async()=>{
  const r=await draft();mock.delay=true;const view=render(<Story report={r.report.id}/>);await waitFor(()=>expect(mock.release).not.toBeNull());
  mock.tenant=i.otherTenant;view.rerender(<Story report={r.report.id}/>);mock.release?.();await transport;
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(mock.rpc.mock.calls.filter(([name])=>name==='apply_closing_report_action')).toHaveLength(0);
 });
 it('never offers another actor’s pending request for recovery',async()=>{
  const r=await draft();mock.lost=true;const view=render(<Story report={r.report.id}/>);await choose('close');fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText('Resposta perdida após confirmação no banco');
  view.rerender(<Story/>);expect(screen.getByRole('button',{name:'Recuperar transição'})).toBeInTheDocument();mock.actor=i.user;view.rerender(<Story/>);
  expect(screen.queryByRole('button',{name:'Recuperar transição'})).not.toBeInTheDocument();expect(pendingClosingAction(localStorage,i.tenant,i.operator)).not.toBeNull();
 });
 it('registers a manual send without invoking messaging, banking or fiscal providers',async()=>{
  const r=await draft();await closingAction(db,await closingActionPayload(db,r.report.id));render(<Story report={r.report.id}/>);await choose('mark_sent');
  expect(screen.getByText(/não envia e-mail ou mensagem/)).toBeInTheDocument();set('Destinatário informado','Financeiro');set('Canal informado','manual');
  fireEvent.click(screen.getByRole('button',{name:'Confirmar ação'}));await screen.findByText(/Pedido confirmado: Registrar envio/);expect(await stored(r.report.id)).toEqual({status:'sent',revision:2});
  expect(new Set(mock.rpc.mock.calls.map(([name])=>name))).toEqual(new Set(['get_closing_report_action_context','apply_closing_report_action']));expect(mock.from).not.toHaveBeenCalled();
 });
});
