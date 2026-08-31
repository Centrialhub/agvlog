import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadItemsPanel from '@/components/loads/LoadItemsPanel';
import {DocumentChangeRecoveryPanel} from '@/components/loads/DocumentChangeRecoveryPanel';
import {createDocumentChangeDatabase,documentChangeIds as i,seedDocumentChanges} from './helpers/documentChangesDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),write:vi.fn(),savePreference:vi.fn(),loseReply:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/hooks/useOrders',()=>({useOrders:()=>({data:[]})}));
vi.mock('@/hooks/useUserUiPreference',()=>({useUserUiPreference:(_key:string,value:unknown)=>({preference:value,isLoaded:true,savePreference:mock.savePreference})}));
vi.mock('@/hooks/useLoadItems',async importOriginal=>{
 const original=await importOriginal<typeof import('@/hooks/useLoadItems')>();return {...original,
  useLoadItems:(load:string)=>useQuery({queryKey:['load_items',load],queryFn:async()=> (await db.query('select * from load_items where load_id=$1 order by id',[load])).rows}),
  useCreateLoadItem:()=>({mutateAsync:mock.write,isPending:false}),useDeleteLoadItem:()=>({mutateAsync:mock.write,isPending:false}),useUpdateLoadItem:()=>({mutateAsync:mock.write,isPending:false})};
});
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,is:()=>query,order:()=>query,limit:async()=>{
  if(table!=='fiscal_documents')throw Error('Unexpected read');return {data:(await db.query('select * from fiscal_documents order by id')).rows,error:null};
 },update:mock.write,delete:mock.write};return query;
}}}));
let db:PGlite;let client:QueryClient;let trips:Awaited<ReturnType<typeof twoPlannedTrips>>;
beforeAll(async()=>{db=await createDocumentChangeDatabase();},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();sessionStorage.clear();mock.loseReply=false;await seedDocumentChanges(db);trips=await twoPlannedTrips(db);
 await db.query("update load_items set item_description=case when id=$1 then 'Nota original' else 'Outra nota' end",[i.item]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});Object.defineProperty(Element.prototype,'scrollTo',{configurable:true,value:vi.fn()});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
  try{let rows:unknown[];
   if(name==='get_load_document_change_context')rows=(await compositionRpc(db,'select get_load_document_change_context($1,$2,$3) result',[args._tenant_id,args._load_id,args._document_ids])).rows;
   else if(name==='change_load_documents')rows=(await compositionRpc(db,'select change_load_documents($1::jsonb) result',[JSON.stringify(args._payload)])).rows;
   else throw Error('Unexpected RPC '+name);
   if(name==='change_load_documents'&&mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
   return {data:(rows[0] as {result:unknown}).result,error:null};
  }catch(error){return {data:null,error};}
 }}));
});
afterEach(()=>{cleanup();client.clear();});
const show=(panel=true)=>render(<QueryClientProvider client={client}><DocumentChangeRecoveryPanel/>{panel?<LoadItemsPanel loadId={i.load}/>:null}</QueryClientProvider>);
const writes=()=>mock.rpc.mock.calls.filter(([name])=>name==='change_load_documents');
async function attachDialog(){
 fireEvent.click(screen.getByRole('button',{name:'Adicionar Item'}));
 fireEvent.click(await screen.findByRole('button',{name:/NF 333/}));fireEvent.click(screen.getByRole('button',{name:'Puxar NF(s)'}));
 const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Motivo da alteração');return dialog;
}
async function choose(dialog:HTMLElement,name:RegExp){fireEvent.keyDown(within(dialog).getByLabelText('Destino dos documentos'),{key:'Enter'});
 fireEvent.click(await screen.findByRole('option',{name}));fireEvent.change(within(dialog).getByLabelText('Motivo da alteração'),{target:{value:'Ajuste confirmado QA'}});}
describe('real invoice panel and SQL candidate, not HTTP/Auth E2E',()=>{
 it('requires an explicit stop and adds the selected note to that exact stop',async()=>{
  show();const dialog=await attachDialog();fireEvent.change(within(dialog).getByLabelText('Motivo da alteração'),{target:{value:'Adicionar nota'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar alteração'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('explicitamente');expect(writes()).toHaveLength(0);
  await choose(dialog,/Parada 1: Cliente QA/);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar alteração'}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({title:'1 NF(s) incluída(s) com confirmação'})));
  expect((await db.query('select dispatch_stop_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc3])).rows[0]).toEqual({dispatch_stop_id:trips.sourceStop});
  expect(mock.write).not.toHaveBeenCalled();
 });
 it('recovers last-note removal after response loss and remount, without the old load panel',async()=>{
  mock.loseReply=true;const view=show();fireEvent.click(await screen.findByRole('button',{name:'Remover Nota original'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Motivo da alteração');
  fireEvent.change(within(dialog).getByLabelText('Motivo da alteração'),{target:{value:'Retirar nota'}});fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar alteração'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await screen.findByRole('button',{name:'Recuperar alteração'});
  expect(mock.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:expect.stringContaining('com confirmação')}));
  const original=writes()[0][1];expect((await db.query('select count(*)::int n from loads where id=$1',[i.load])).rows[0]).toEqual({n:0});
  view.unmount();show(false);fireEvent.click(await screen.findByRole('button',{name:'Recuperar alteração'}));
  await screen.findByText('1 nota(s): alteração confirmada; carga vazia removida.');expect(writes()[1][1]).toEqual(original);expect(localStorage.length).toBe(0);
  expect((await db.query("select count(*)::int n from entity_audit_log where source='document_composition'")).rows[0]).toEqual({n:1});
 });
 it('does not offer another load’s note as an automatic reassignment',async()=>{
  show();fireEvent.click(screen.getByRole('button',{name:'Adicionar Item'}));
  const other=await screen.findByRole('button',{name:/Use realocação/});expect(other).toBeDisabled();expect(writes()).toHaveLength(0);
 });
 it('leaves a stale selection rejected with no successful toast or partial attachment',async()=>{
  show();const dialog=await attachDialog();await choose(dialog,/Parada 1: Cliente QA/);
  await db.query("update fiscal_documents set product_summary='Outro operador' where id=$1",[i.doc3]);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar alteração'}));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('tentativa foi desfeita');expect(localStorage.length).toBe(0);
  expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc3])).rows[0]).toEqual({load_id:null});
 });
});
