import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {ComponentProps} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadNotesPanel from '@/components/loads/LoadNotesPanel';
import {DocumentMetadataRecoveryPanel} from '@/components/loads/DocumentMetadataRecoveryPanel';
import {createDocumentMetadataDatabase,updateMetadata,metadataPayload} from './helpers/documentMetadataDatabase';
import {seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {correctOperation,correctionPayload} from './helpers/operationCorrectionDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),info:vi.fn(),from:vi.fn(),loseReply:false,tenant:'',actor:'',hideContext:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mock.success,error:vi.fn(),info:mock.info})}));
vi.mock('@/lib/printLoadNotes',()=>({printLoadNotesReport:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite;let stop:string;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,stop}=await createDocumentMetadataDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.loseReply=false;mock.hideContext=false;mock.tenant=i.tenant;mock.actor=i.operator;
 mock.from.mockImplementation(()=>{throw new Error('Unexpected direct metadata or load table write');});
 await db.exec('begin');await db.query("update fiscal_documents set invoice_number=case when id=$1 then '111' else '222' end,client_load_source='{\"observation\":\"PAGAMENTO PIX\"}' where load_id=$2",[i.doc,i.load]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:()=>{
  const actor=mock.actor;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(name==='update_load_document_metadata'){
    data=await updateMetadata(db,args._payload);if(mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
   }else if(name==='get_load_operational_documents'){
    data=(await operationRpc(db,'select get_load_operational_documents($1,$2) result',[args._tenant_id,args._load_id])).rows[0].result;
    if(mock.hideContext)for(const document of (data as {documents:Array<{operational_metadata?:unknown}>}).documents)delete document.operational_metadata;
   }else throw new Error('Unexpected metadata RPC '+name);
   return {data,error:null};
  }catch(error){return {data:null,error};}};
  const pending=transport.then(work,work);transport=pending;return pending;
 }}));
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');});
function Panel(){
 const rows=useQuery({queryKey:['load_documents',i.load,mock.tenant,mock.actor],queryFn:async()=>{
  const response=await mock.rpc('get_load_operational_documents',{_tenant_id:mock.tenant,_load_id:i.load}).abortSignal();if(response.error)throw response.error;return response.data.documents;
 }});
 const props={load:{id:i.load,load_number:'1003'},documents:rows.data||[]} as ComponentProps<typeof LoadNotesPanel>;
 return rows.data?<LoadNotesPanel {...props}/>:null;
}
const show=(panel=true)=>render(<QueryClientProvider client={client}><DocumentMetadataRecoveryPanel/>{panel?<Panel/>:null}</QueryClientProvider>);
const writes=()=>mock.rpc.mock.calls.filter(([name])=>name==='update_load_document_metadata');
const count=async()=>(await db.query<{n:number}>('select count(*)::int n from delivery_document_metadata_audits')).rows[0].n;
async function suggest(){await screen.findByRole('row',{name:/111/});fireEvent.click(screen.getByRole('button',{name:'Detectar formas de pagamento'}));}
async function review(){fireEvent.click(screen.getByRole('button',{name:/Salvar Notas/}));const dialog=await screen.findByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Motivo e fonte da conferência'),{target:{value:'Conferência das observações XML pela operação QA'}});return dialog;}
// Includes WASM SQL transactions, React invalidations and DOM interactions; the global coverage run
// executes many database fixtures concurrently. Keep assertions/retries unchanged, but budget the whole story.
describe('real metadata conference frontend against local PostgreSQL',{timeout:15000},()=>{
 it('opens without writes, stages XML suggestions, and saves both notes only after explicit review',async()=>{
  show();await screen.findByRole('row',{name:/111/});expect(mock.from).not.toHaveBeenCalled();expect(writes()).toHaveLength(0);
  expect(screen.getByLabelText('Canhoto recebido da nota 111')).toBeDisabled();expect(screen.getByLabelText('Data e hora auditadas da nota 111')).toHaveAttribute('readonly');
  await suggest();expect(writes()).toHaveLength(0);expect(await count()).toBe(0);expect(screen.getByRole('button',{name:'Salvar Notas (2)'})).toBeEnabled();
  expect(within(screen.getByRole('row',{name:/111/})).getByRole('button',{name:'Reentrega'})).toBeDisabled();
  const dialog=await review();fireEvent.click(within(dialog).getByRole('button',{name:'Salvar conferência'}));await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));
  expect(await count()).toBe(2);expect(writes()).toHaveLength(1);expect(localStorage.length).toBe(0);expect(mock.from).not.toHaveBeenCalled();
  expect(writes()[0][1]._payload.items).toEqual(expect.arrayContaining([expect.objectContaining({document_id:i.doc,changes:{payment_method:'pix'}})]));
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'confirmed'});
 });
 it('retains a stale batch without partial saves and requires explicit rebase of the drafts',async()=>{
  show();await suggest();const dialog=await review();
  await db.query("update fiscal_documents set delivery_meta=delivery_meta||'{\"contact_email\":\"new@example.invalid\"}' where id=$1",[i.doc2]);
  fireEvent.click(within(dialog).getByRole('button',{name:'Salvar conferência'}));await within(dialog).findByText(/A nota ou tentativa mudou/);
  expect(await count()).toBe(0);expect(localStorage.length).toBe(0);expect(within(dialog).getByLabelText('Motivo e fonte da conferência')).toHaveValue('Conferência das observações XML pela operação QA');
  fireEvent.click(within(dialog).getByRole('button',{name:'Fechar'}));expect(screen.getByRole('button',{name:'Salvar Notas (2)'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Revisar rascunhos sobre valores atuais'}));const second=await review();
  fireEvent.click(within(second).getByRole('button',{name:'Salvar conferência'}));await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));
  expect(await count()).toBe(2);expect((await db.query("select delivery_meta->>'contact_email' contact from fiscal_documents where id=$1",[i.doc2])).rows[0]).toEqual({contact:'new@example.invalid'});
 });
 it('recovers a committed batch after remount without another audit or changed body',async()=>{
  mock.loseReply=true;const view=show();await suggest();const dialog=await review();fireEvent.click(within(dialog).getByRole('button',{name:'Salvar conferência'}));
  await within(dialog).findByText(/O servidor não confirmou a conferência/);expect(mock.success).not.toHaveBeenCalled();expect(await count()).toBe(2);const original=writes()[0][1];
  view.unmount();show(false);fireEvent.click(await screen.findByRole('button',{name:'Recuperar conferência'}));await screen.findByText(/Conferência confirmada; resultados de entrega/);
  expect(writes()[1][1]).toEqual(original);expect(await count()).toBe(2);expect(localStorage.length).toBe(0);
 });
 it('never carries a receipt draft across a corrected outcome',async()=>{
  await seedUndelivered(db,stop);show();const receipt=await screen.findByLabelText('Canhoto recebido da nota 111');expect(receipt).toBeEnabled();fireEvent.click(receipt);
  await correctOperation(db,await correctionPayload(db,stop));await client.invalidateQueries({queryKey:['load_documents']});
  await screen.findByText(/As notas mudaram desde a edição/);fireEvent.click(screen.getByRole('button',{name:'Revisar rascunhos sobre valores atuais'}));
  expect(screen.getByRole('button',{name:'Salvar Notas (1)'})).toBeDisabled();expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Descartar rascunhos'}));expect(screen.getByLabelText('Canhoto recebido da nota 111')).not.toBeChecked();
 });
 it('blocks edits when the deployed reader has no metadata contract',async()=>{
  mock.hideContext=true;show();await screen.findByRole('row',{name:/111/});expect(screen.getByRole('button',{name:'Detectar formas de pagamento'})).toBeDisabled();
  expect(screen.getByLabelText('Forma de pagamento da nota 111')).toBeDisabled();expect(mock.from).not.toHaveBeenCalled();expect(writes()).toHaveLength(0);
 });
 it('updates unchanged rows after a refetch without replacing a different note draft',async()=>{
  show();await screen.findByRole('row',{name:/111/});fireEvent.click(screen.getByRole('button',{name:'Sugerir pagamento pela observação da nota 111'}));
  const payload=await metadataPayload(db,{payment_method:'boleto'},i.doc2);await updateMetadata(db,payload);await client.invalidateQueries({queryKey:['load_documents']});
  await waitFor(()=>expect(screen.getByLabelText('Forma de pagamento da nota 222')).toHaveTextContent('Boleto'));expect(screen.getByLabelText('Forma de pagamento da nota 111')).toHaveTextContent('PIX');
  expect(screen.getByRole('button',{name:'Salvar Notas (1)'})).toBeEnabled();expect(writes()).toHaveLength(0);
 });
});
