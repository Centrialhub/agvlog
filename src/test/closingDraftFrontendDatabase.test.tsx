import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {CreateClosingReportPanel} from '@/components/closingReports/CreateClosingReportPanel';
import {ClosingDraftRecoveryPanel} from '@/components/closingReports/ClosingDraftRecoveryPanel';
import {ClosingImportPanel} from '@/components/closingReports/ClosingImportPanel';
import {ClosingTripEditor} from '@/components/closingReports/ClosingTripEditor';
import type {ClosingReportRow} from '@/hooks/useClosingReports';
import * as XLSX from 'xlsx';
import {createClosingDraftDatabase,closingDraftPayload,createClosingDraft} from './helpers/closingDraftDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {pendingClosingDraft} from '@/lib/closingReports/closingDraftOutbox';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',lost:false,delay:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db}=await createClosingDraftDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=false;mock.delay=false;mock.release=null;
 await db.exec('begin');client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.from.mockImplementation(()=>{throw new Error('Direct table write/read is forbidden in creation');});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(name==='get_closing_report_sources')data=(await operationRpc(db,'select get_closing_report_sources($1,$2::jsonb) result',[args._tenant_id,JSON.stringify(args._filters)])).rows[0].result;
   else if(name==='create_closing_report_draft')data=(await operationRpc(db,'select create_closing_report_draft($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else if(name==='update_closing_report_trip_fields')data=(await operationRpc(db,'select update_closing_report_trip_fields($1,$2,$3,$4::jsonb,$5::jsonb) result',[args._tenant_id,args._report_id,args._item_id,JSON.stringify(args._expected),JSON.stringify(args._patch)])).rows[0].result;
   else throw new Error('Unexpected RPC '+name);
   if(mock.delay&&name==='get_closing_report_sources'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='create_closing_report_draft'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(work,work);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({importing=false,editing}:{importing?:boolean;editing?:ClosingReportRow}={}){return <QueryClientProvider client={client}><ClosingDraftRecoveryPanel/>{editing?<ClosingTripEditor report={editing} onClose={()=>{}}/>:importing?<ClosingImportPanel/>:<CreateClosingReportPanel clients={[]} vehicles={[]} drivers={[]}/>}</QueryClientProvider>;}
const set=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
async function preview(){set('Período início','2026-08-01');set('Período fim','2026-08-31');set('Motivo da criação (obrigatório)','Conferência da operação');fireEvent.click(screen.getByRole('button',{name:'Gerar prévia'}));await screen.findByRole('table');}
async function reportCount(){return (await db.query<{n:number}>('select count(*)::int n from closing_reports')).rows[0].n;}
describe('closing creation screen with real SQL writer',{timeout:15000},()=>{
 it('creates an authoritative draft and never sends client items or totals',async()=>{
  render(<Story/>);await preview();fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByText(/Rascunho criado:/);
  expect(await reportCount()).toBe(1);const body=mock.rpc.mock.calls.find(([name])=>name==='create_closing_report_draft')![1]._payload;
  expect(body).not.toHaveProperty('items');expect(body).not.toHaveProperty('totals');expect(body.actor_id).toBe(i.operator);expect(mock.from).not.toHaveBeenCalled();
  expect(pendingClosingDraft(localStorage,i.tenant,i.operator)).toBeNull();
 });
 it('recovers a lost response after remount without duplicating the report',async()=>{
  mock.lost=true;const view=render(<Story/>);await preview();fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByRole('button',{name:'Recuperar fechamento'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar rascunho'})).toBeDisabled());expect(await reportCount()).toBe(1);
  const request=pendingClosingDraft(localStorage,i.tenant,i.operator)!.payload.request_id;view.unmount();render(<Story/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar fechamento'}));await screen.findByText(/Pedido de criação confirmado:/);expect(await reportCount()).toBe(1);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='create_closing_report_draft').map(([,args])=>args._payload.request_id)).toEqual([request,request]);
 });
 it('rejects a changed source and clears only the definitely rejected request',async()=>{
  render(<Story/>);await preview();await db.query('update fiscal_documents set freight_value=99 where id=$1',[i.doc]);
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByText(/A origem mudou ou está em atualização/);
  expect(await reportCount()).toBe(0);expect(pendingClosingDraft(localStorage,i.tenant,i.operator)).toBeNull();
 });
 it('invalidates the old preview immediately when a filter changes',async()=>{
  render(<Story/>);await preview();set('Período fim','2026-08-30');expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Salvar rascunho'})).toBeDisabled();expect(await reportCount()).toBe(0);
 });
 it('hides a delayed preview when the tenant changes',async()=>{
  mock.delay=true;const view=render(<Story/>);set('Período início','2026-08-01');set('Período fim','2026-08-31');fireEvent.click(screen.getByRole('button',{name:'Gerar prévia'}));
  await waitFor(()=>expect(mock.release).not.toBeNull());mock.tenant=i.otherTenant;view.rerender(<Story/>);mock.release?.();await transport;
  expect(screen.queryByRole('table')).not.toBeInTheDocument();expect(screen.getByLabelText('Período início')).toHaveValue('');expect(await reportCount()).toBe(0);
 });
 it('does not send a write if durable browser storage is unavailable',async()=>{
  render(<Story/>);await preview();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota exceeded');});
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByText(/Recuperação do fechamento indisponível/);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='create_closing_report_draft')).toHaveLength(0);expect(await reportCount()).toBe(0);
 });
 it('does not expose another actor’s pending request',async()=>{
  mock.lost=true;const view=render(<Story/>);await preview();fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByRole('button',{name:'Recuperar fechamento'});
  mock.actor=i.user;view.rerender(<Story/>);expect(screen.queryByRole('button',{name:'Recuperar fechamento'})).not.toBeInTheDocument();expect(screen.queryByRole('table')).not.toBeInTheDocument();
 });
 it('imports a real summary workbook atomically while preserving totals and requiring review',async()=>{
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['CARGAS RECEBIDAS'],['DATA CHEGADA','FATURAMENTO','PESO MANIFESTO','R$ VALOR FATURADO'],['01/08/2026','Agosto',42,1234.56]]),'Resumo');
  const file=new File([new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'}))],'resumo.xlsx');render(<Story importing/>);
  fireEvent.change(screen.getByLabelText('Planilha de fechamento'),{target:{files:[file]}});await screen.findByText(/Modelo: Resumo/);
  set('Período inicial da importação','2026-08-01');set('Período final da importação','2026-08-31');set('Motivo da importação','Conferência do legado');
  fireEvent.click(screen.getByRole('button',{name:'Criar rascunho importado'}));await screen.findByText(/Rascunho importado:/);
  expect((await db.query('select total_invoice_value::float value,fiscal_document_count notes,report_model from closing_reports')).rows[0]).toEqual({value:1234.56,notes:0,report_model:'summary'});
  expect((await db.query('select count(*)::int n from closing_report_items')).rows[0]).toEqual({n:0});
 });
 it('edits trip quantities through the guarded SQL RPC and protects operational identity',async()=>{
  const created=await createClosingDraft(db,await closingDraftPayload(db));
  const report=(await db.query<{row:ClosingReportRow}>('select to_jsonb(r) row from closing_reports r where id=$1',[created.report.id])).rows[0].row;
  mock.from.mockImplementation((table:string)=>{expect(table).toBe('closing_report_items');const filters:Record<string,string>={};
   const builder={select:()=>builder,eq:(key:string,value:string)=>{filters[key]=value;return builder;},order:()=>builder,abortSignal:()=>{
    const work=async()=>{try{const rows=(await operationRpc(db,'select coalesce(jsonb_agg(to_jsonb(item) order by sort_order),\'[]\') result from closing_report_items item where tenant_id=$1 and closing_report_id=$2',[filters.tenant_id,filters.closing_report_id])).rows[0].result;return {data:rows,error:null};}catch(error){return {data:null,error};}};
    const pending=transport.then(work,work);transport=pending;return pending;}};return builder;
  });
  render(<Story editing={report}/>);await screen.findAllByLabelText(/KM inicial da carga/);
  expect(screen.getAllByLabelText(/Placa da carga/)[0]).toHaveAttribute('readonly');
  for(const [label,value] of [['KM inicial','100'],['KM final','200'],['Litros','10'],['Preço por litro','5']])fireEvent.change(screen.getAllByLabelText(new RegExp(label+' da carga'))[0],{target:{value}});
  fireEvent.click(screen.getAllByRole('button',{name:/Salvar dados da carga/})[0]);await screen.findByText('Dados de viagem confirmados.');
  expect((await db.query('select total_km_driven::float km,total_fuel_cost::float fuel from closing_reports where id=$1',[report.id])).rows[0]).toEqual({km:100,fuel:50});
  fireEvent.change(screen.getAllByLabelText(/Litros da carga/)[0],{target:{value:'20'}});fireEvent.click(screen.getAllByRole('button',{name:/Salvar dados da carga/})[0]);
  await waitFor(()=>expect(mock.rpc.mock.calls.filter(([name])=>name==='update_closing_report_trip_fields')).toHaveLength(2));await transport;
  expect((await db.query('select total_fuel_cost::float fuel from closing_reports where id=$1',[report.id])).rows[0]).toEqual({fuel:100});
 });
});
