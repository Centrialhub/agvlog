import {createDeliveryAttemptDatabase} from './helpers/deliveryAttemptDatabase';
import {createRedeliveryDatabase} from './helpers/redeliveryDatabase';
import {createDocumentMetadataDatabase,metadataPayload,updateMetadata} from './helpers/documentMetadataDatabase';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {ComponentProps} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadNotesPanel from '@/components/loads/LoadNotesPanel';
import {OperationOutcomeRecoveryPanel} from '@/components/loads/OperationOutcomeRecoveryPanel';
import {createOperationDatabase,operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),loseReply:false,contextError:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mock.success,error:mock.error,info:vi.fn()})}));
vi.mock('@/lib/printLoadNotes',()=>({printLoadNotesReport:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>{throw new Error('Unexpected direct data write in outcome test');}}}));
afterAll(()=>vi.unstubAllGlobals());
describe.each(['previous','attempt-foundation','redelivery','metadata'] as const)('schema: %s',stage=>{
let db:PGlite;let stop:string;let client:QueryClient;
beforeAll(async()=>{({db,stop}=await (stage==='metadata'?createDocumentMetadataDatabase():stage==='redelivery'?createRedeliveryDatabase():stage==='attempt-foundation'?createDeliveryAttemptDatabase():createOperationDatabase()));},30000);afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.loseReply=false;mock.contextError=false;localStorage.clear();await db.exec('begin');
 await db.query("update fiscal_documents set invoice_number=case when id=$1 then '111' else '222' end,delivery_meta='{}' where load_id=$2",[i.doc,i.load]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
  if(name==='get_operation_document_context'&&mock.contextError)return {data:null,error:{message:'Falha de leitura QA'}};
  try{
   const result=name==='get_operation_document_context'
    ?await operationRpc(db,'select get_operation_document_context($1,$2,$3) result',[args._tenant_id,args._load_id,args._document_id])
    :await operationRpc(db,'select record_operation_document_outcome($1::jsonb) result',[JSON.stringify(args._payload)]);
   if(name==='record_operation_document_outcome'&&mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
   return {data:(result.rows[0] as {result:unknown}).result,error:null};
  }catch(error){return {data:null,error};}
 }}));
});
afterEach(async()=>{cleanup();client.clear();await db.exec('rollback');});
function Panel(){const rows=useQuery({queryKey:['load_documents',i.load],queryFn:async()=>(await db.query('select * from fiscal_documents where load_id=$1 order by invoice_number',[i.load])).rows});
 const props={load:{id:i.load,load_number:'1003'},documents:rows.data||[]} as unknown as ComponentProps<typeof LoadNotesPanel>;
 return rows.data?<LoadNotesPanel {...props}/>:null;
}
const show=(panel=true)=>render(<QueryClientProvider client={client}><OperationOutcomeRecoveryPanel/>{panel?<Panel/>:null}</QueryClientProvider>);
async function open(outcome='Entregue'){
 fireEvent.click((await screen.findAllByRole('button',{name:new RegExp('^'+outcome+'$')}))[0]);
 return await screen.findByRole('dialog');
}
async function fill(dialog:HTMLElement,delivered=true){
 await waitFor(()=>expect(within(dialog).getByRole('option',{name:/arrived/})).toBeInTheDocument());
 fireEvent.change(within(dialog).getByLabelText('Parada confirmada'),{target:{value:stop}});
 const t=new Date();const pad=(x:number)=>String(x).padStart(2,'0');const local=`${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
 fireEvent.change(within(dialog).getByLabelText('Data e hora reais do resultado'),{target:{value:local}});
 if(delivered)fireEvent.change(within(dialog).getByLabelText('Nome do recebedor'),{target:{value:'Recebedor real QA'}});
 fireEvent.change(within(dialog).getByLabelText('Motivo e fonte da confirmação'),{target:{value:'Confirmado com recebedor pela operação'}});
}
const writes=()=>mock.rpc.mock.calls.filter(([name])=>name==='record_operation_document_outcome');
describe('real LoadNotesPanel, dialog, hook and outbox to PostgreSQL',()=>{
 it('requires explicit stop and actual time before one-note manual confirmation, with proof pending',async()=>{
  const portalKey=['portal_shipment_detail_v2',i.doc];client.setQueryData(portalKey,{status:'in_transit'});
  show();const dialog=await open();expect(within(dialog).getByRole('button',{name:'Confirmar resultado'})).toBeDisabled();expect(writes()).toHaveLength(0);
  await fill(dialog);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar resultado'}));
  await waitFor(()=>expect(mock.success).toHaveBeenCalledWith('Resultado confirmado; comprovante pendente.'));
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'delivered'});
  expect((await db.query('select status from proof_of_delivery')).rows[0]).toEqual({status:'pending'});expect(localStorage.length).toBe(0);
  expect(client.getQueryState(portalKey)?.isInvalidated).toBe(true);
 });
 it('records non-delivery with reason without requiring or generating a receiver proof',async()=>{
  show();const dialog=await open('Não Entregue');expect(within(dialog).queryByLabelText('Nome do recebedor')).not.toBeInTheDocument();
  await fill(dialog,false);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar resultado'}));await waitFor(()=>expect(mock.success).toHaveBeenCalledWith('Resultado da nota confirmado.'));
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'not_delivered'});
  expect((await db.query('select count(*)::int n from proof_of_delivery')).rows[0]).toEqual({n:0});
 });
 it('recovers an uncertain committed confirmation after remount with exactly the same payload',async()=>{
  mock.loseReply=true;const view=show();const dialog=await open();await fill(dialog);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar resultado'}));
  await within(dialog).findByText(/O servidor não confirmou/);expect(mock.success).not.toHaveBeenCalled();const original=writes()[0][1];
  view.unmount();show(false);fireEvent.click(await screen.findByRole('button',{name:'Recuperar resultado'}));
  await screen.findByText('Resultado operacional confirmado. Confira a nota e a situação do comprovante.');
  expect(writes()[1][1]).toEqual(original);expect((await db.query('select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:1});expect(localStorage.length).toBe(0);
 });
 it('rejects stale context without false success and preserves the entered reason for review',async()=>{
  show();const dialog=await open();await fill(dialog);if(stage==='metadata')await updateMetadata(db,await metadataPayload(db));else await db.query("update fiscal_documents set delivery_meta=jsonb_build_object('payment_method','pix') where id=$1",[i.doc]);
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar resultado'}));await within(dialog).findByText(/A nota, parada ou comprovante mudou/);
  expect(mock.success).not.toHaveBeenCalled();expect(within(dialog).getByLabelText('Motivo e fonte da confirmação')).toHaveValue('Confirmado com recebedor pela operação');
  expect((await db.query('select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:0});
 });
 it('blocks confirmation on read failure and allows retry without bypassing context',async()=>{
  mock.contextError=true;show();const dialog=await open();await within(dialog).findByText(/Falha de leitura QA/);
  expect(within(dialog).getByRole('button',{name:'Confirmar resultado'})).toBeDisabled();mock.contextError=false;
  fireEvent.click(within(dialog).getByRole('button',{name:'Tentar novamente'}));await fill(dialog);expect(writes()).toHaveLength(0);
 });
});
});
