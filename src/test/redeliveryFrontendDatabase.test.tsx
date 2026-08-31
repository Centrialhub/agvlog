import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {ComponentProps} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadNotesPanel from '@/components/loads/LoadNotesPanel';
import {RedeliveryRecoveryPanel} from '@/components/loads/RedeliveryRecoveryPanel';
import {createRedeliveryDatabase,requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
import {seedUndelivered,driverPartial} from './helpers/deliveryAttemptDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),loseReply:false,readError:false,tamper:false,tenant:'',actor:''}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mock.success,error:mock.error,info:vi.fn()})}));
vi.mock('@/lib/printLoadNotes',()=>({printLoadNotesReport:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>{throw new Error('Unexpected direct table write in audited redelivery');}}}));
let db:PGlite;let trip:string;let stop:string;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,trip,stop}=await createRedeliveryDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.loseReply=false;mock.readError=false;mock.tamper=false;mock.tenant=i.tenant;mock.actor=i.operator;
 await db.exec('begin');await db.query("update fiscal_documents set invoice_number=case when id=$1 then '111' else '222' end where load_id=$2",[i.doc,i.load]);
 await db.query("update load_items set item_description='Produto QA' where fiscal_document_id=$1",[i.doc]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:()=>{
  const actor=mock.actor;const work=async()=>{
   try{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    if(name==='get_redelivery_context'&&mock.readError)return {data:null,error:{message:'Leitura temporariamente indisponível QA'}};
    let data:unknown;
    if(name==='request_document_redelivery'){
     data=await requestRedelivery(db,args._payload);
     if(mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
    }else if(name==='get_redelivery_context'){
     data=(await operationRpc(db,'select get_redelivery_context($1,$2) result',[args._tenant_id,args._document_id])).rows[0].result;
     if(mock.tamper)data={...(data as object),actor_id:i.user};
    }else if(name==='get_load_operational_documents'){
     data=(await operationRpc(db,'select get_load_operational_documents($1,$2) result',[args._tenant_id,args._load_id])).rows[0].result;
    }else throw new Error('Unexpected redelivery RPC '+name);
    return {data,error:null};
   }catch(error){return {data:null,error};}
  };
  const pending=transport.then(work,work);transport=pending;return pending;
 }}));
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');});
function Panel(){
 const rows=useQuery({queryKey:['load_documents',i.load,mock.tenant,mock.actor],queryFn:async()=>{
  const response=await mock.rpc('get_load_operational_documents',{_tenant_id:mock.tenant,_load_id:i.load}).abortSignal();
  if(response.error)throw response.error;return response.data.documents;
 }});
 const props={load:{id:i.load,load_number:'1003'},documents:rows.data||[]} as ComponentProps<typeof LoadNotesPanel>;
 return rows.data?<LoadNotesPanel {...props}/>:null;
}
const show=(panel=true)=>render(<QueryClientProvider client={client}><RedeliveryRecoveryPanel/>{panel?<Panel/>:null}</QueryClientProvider>);
const writes=()=>mock.rpc.mock.calls.filter(([name])=>name==='request_document_redelivery');
async function open(){
 const row=await screen.findByRole('row',{name:/111/});fireEvent.click(within(row).getByRole('button',{name:'Reentrega'}));
 const dialog=await screen.findByRole('dialog');await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Revisar saldo atual'})).toBeEnabled());
 fireEvent.click(within(dialog).getByRole('button',{name:'Revisar saldo atual'}));
 fireEvent.change(within(dialog).getByLabelText('Motivo e conferência da reentrega'),{target:{value:'Saldo conferido pela operação QA'}});return dialog;
}
describe('real redelivery dialog, outbox and operation readers against local PostgreSQL',()=>{
 it('atomically releases the note and renders the prior allocation read-only without a table reset',async()=>{
  await seedUndelivered(db,stop);show();const dialog=await open();
  expect(within(dialog).getByLabelText('Descrição do saldo — item 1')).toHaveValue('Produto QA');
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar reentrega'}));
  await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));
  const history=await screen.findByRole('region',{name:'Tentativas anteriores desta carga'});
  expect(history).toHaveTextContent('Nota 111 — Devolvido');expect(within(history).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Reentrega'})).toHaveLength(1);
  expect(writes()).toHaveLength(1);expect(localStorage.length).toBe(0);
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:1});
  expect((await db.query('select id,load_id from load_items where id=$1',[i.item])).rows[0]).toEqual({id:i.item,load_id:i.load});
 });
 it('requires explicit physical measures for a partial balance and never edits its quantity',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:2});show();const dialog=await open();
  expect(within(dialog).getByText('Item 1 — saldo 2 de 10')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Peso (kg) — item 1')).toHaveValue(null);
  expect(within(dialog).getByRole('button',{name:'Confirmar reentrega'})).toBeDisabled();
  for(const [label,value] of [['Pallets — item 1','1'],['Peso (kg) — item 1','2'],['Cubagem (m³) — item 1','0.2']]){
   fireEvent.change(within(dialog).getByLabelText(label),{target:{value}});
  }
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar reentrega'}));await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));
  expect((await db.query("select (items->0->>'quantity')::float8 quantity,(items->0->>'weight_kg')::float8 weight from delivery_attempts")).rows[0]).toEqual({quantity:2,weight:2});
  expect((await db.query('select is_active from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({is_active:false});
 });
 it('recovers a committed release after remount using the same actor, request and payload',async()=>{
  await seedUndelivered(db,stop);mock.loseReply=true;const view=show();const dialog=await open();
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar reentrega'}));await within(dialog).findByText(/O servidor não confirmou a reentrega/);
  expect(mock.success).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);const original=writes()[0][1];
  view.unmount();show(false);fireEvent.click(await screen.findByRole('button',{name:'Recuperar reentrega'}));
  await screen.findByText('Reentrega confirmada; histórico preservado e saldo disponível para nova carga.');
  expect(writes()[1][1]).toEqual(original);expect(localStorage.length).toBe(0);
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:1});
 });
 it('rejects stale context and preserves the operator reason for explicit review',async()=>{
  await seedUndelivered(db,stop);show();const dialog=await open();
  await db.query("update fiscal_documents set delivery_meta=delivery_meta||'{\"payment_method\":\"pix\"}' where id=$1",[i.doc]);
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar reentrega'}));await within(dialog).findByText(/A nota ou a viagem mudou/);
  expect(mock.success).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  expect(within(dialog).getByLabelText('Motivo e conferência da reentrega')).toHaveValue('Saldo conferido pela operação QA');
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:0});
 });
 it('does not release an issued note or silently remove its fiscal flag',async()=>{
  await db.query('update fiscal_documents set cte_emitted_at=clock_timestamp() where id=$1',[i.doc]);await seedUndelivered(db,stop);show();
  fireEvent.click(within(await screen.findByRole('row',{name:/111/})).getByRole('button',{name:'Reentrega'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByText(/Há documento fiscal emitido/);
  expect(within(dialog).getByRole('button',{name:'Confirmar reentrega'})).toBeDisabled();expect(writes()).toHaveLength(0);
  expect((await db.query('select cte_emitted_at is not null retained from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({retained:true});
 });
 it('fails closed on a read error and allows a genuine retry',async()=>{
  await seedUndelivered(db,stop);mock.readError=true;show();
  fireEvent.click(within(await screen.findByRole('row',{name:/111/})).getByRole('button',{name:'Reentrega'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByText(/Leitura temporariamente indisponível QA/);
  expect(within(dialog).getByRole('button',{name:'Revisar saldo atual'})).toBeDisabled();mock.readError=false;
  fireEvent.click(within(dialog).getByRole('button',{name:'Tentar novamente'}));
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Revisar saldo atual'})).toBeEnabled());expect(writes()).toHaveLength(0);
 });
 it('rejects a context returned for a different actor',async()=>{
  await seedUndelivered(db,stop);mock.tamper=true;show();
  fireEvent.click(within(await screen.findByRole('row',{name:/111/})).getByRole('button',{name:'Reentrega'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByText(/Contexto da reentrega não confirmado/);
  expect(within(dialog).getByRole('button',{name:'Confirmar reentrega'})).toBeDisabled();expect(writes()).toHaveLength(0);
 });
 it('never auto-edits historical metadata even when its source observation mentions payment',async()=>{
  await db.query("update fiscal_documents set client_load_source='{\"observation\":\"PAGAMENTO PIX\"}' where id=$1",[i.doc]);
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));show();
  await screen.findByRole('region',{name:'Tentativas anteriores desta carga'});expect(writes()).toHaveLength(0);
  expect((await db.query("select delivery_meta->>'payment_method' payment from fiscal_documents where id=$1",[i.doc])).rows[0]).toEqual({payment:null});
 });
});
