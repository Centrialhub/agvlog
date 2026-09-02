import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadItemsPanel from '@/components/loads/LoadItemsPanel';
import {ItemPreparationRecoveryPanel} from '@/components/loads/ItemPreparationRecoveryPanel';
import {createItemWriterDatabase,itemWriterIds as i,seedItemWriter} from './helpers/loadItemWriterDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
vi.mock('@/components/ui/select',async()=>{
 const React=await import('react');
 type ChildProps={id?:string;value?:string;disabled?:boolean;'aria-label'?:string;children?:import('react').ReactNode};
 const SelectTrigger=()=>null;
 const SelectContent=()=>null;
 const SelectItem=()=>null;
 const SelectValue=()=>null;
 const Select=({children,value,onValueChange,disabled}:{children?:import('react').ReactNode;value?:string;
  onValueChange?:(value:string)=>void;disabled?:boolean})=>{
  let id:string|undefined;let ariaLabel:string|undefined;const options:Array<{value:string;disabled?:boolean;text:string}>=[];
  const textOf=(node:import('react').ReactNode):string=>React.Children.toArray(node).map(child=>
   typeof child==='string'||typeof child==='number'?String(child):
    React.isValidElement<ChildProps>(child)?textOf(child.props.children):'').join(' ').replace(/\s+/g,' ')
   .replace(/\s+([:;,.])/g,'$1').trim();
  const visit=(node:import('react').ReactNode):void=>React.Children.forEach(node,child=>{
   if(!React.isValidElement<ChildProps>(child))return;
   if(child.type===SelectTrigger){id=child.props.id;ariaLabel=child.props['aria-label'];}
   else if(child.type===SelectItem&&child.props.value)options.push({value:child.props.value,
    disabled:child.props.disabled,text:textOf(child.props.children)});
   else visit(child.props.children);
  });
  visit(children);
  return React.createElement('select',{id,'aria-label':ariaLabel,role:'combobox',value,disabled,
   onChange:(event:import('react').ChangeEvent<HTMLSelectElement>)=>onValueChange?.(event.currentTarget.value)},
  React.createElement('option',{value:'',disabled:true},''),
  ...options.map(option=>React.createElement('option',{key:option.value,value:option.value,disabled:option.disabled},option.text)));
 };
 return {Select,SelectTrigger,SelectContent,SelectItem,SelectValue,SelectGroup:SelectContent,
  SelectLabel:SelectContent,SelectSeparator:()=>null,SelectScrollUpButton:()=>null,SelectScrollDownButton:()=>null};
});
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),savePreference:vi.fn(),loseReply:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/hooks/useOrders',()=>({useOrders:()=>({data:[]})}));
vi.mock('@/hooks/useUserUiPreference',()=>({useUserUiPreference:(_key:string,value:unknown)=>({preference:value,isLoaded:true,savePreference:mock.savePreference})}));
vi.mock('@/hooks/useLoadItems',async importOriginal=>({...await importOriginal<typeof import('@/hooks/useLoadItems')>(),
 useLoadItems:(load:string)=>useQuery({queryKey:['load_items',load],queryFn:async()=> (await db.query('select * from load_items where load_id=$1 order by id',[load])).rows})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>{
 const query={select:()=>query,eq:()=>query,is:()=>query,order:()=>query,limit:async()=>({data:[],error:null})};return query;
}}}));
let db:PGlite;let client:QueryClient;
beforeAll(async()=>{db=await createItemWriterDatabase();},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();sessionStorage.clear();mock.loseReply=false;await seedItemWriter(db);
 await db.query("update load_items set item_description='Nota original' where id=$1",[i.item]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});Object.defineProperty(Element.prototype,'scrollTo',{configurable:true,value:vi.fn()});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:{_payload:unknown})=>({abortSignal:async()=>{
  expect(name).toBe('save_load_item_preparation');
  try{const row=(await compositionRpc(db,'select save_load_item_preparation($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0] as {result:unknown};
   if(mock.loseReply){mock.loseReply=false;return {data:{},error:null};}return {data:row.result,error:null};
  }catch(error){return {data:null,error};}
 }}));
});
afterEach(()=>{cleanup();client.clear();});
const show=(load:string|null=i.load)=>render(<QueryClientProvider client={client}><ItemPreparationRecoveryPanel/>{load?<LoadItemsPanel loadId={load}/>:null}</QueryClientProvider>);
async function manual(){fireEvent.click(screen.getByRole('button',{name:'Adicionar Item'}));fireEvent.click(screen.getByRole('button',{name:'Item manual'}));
 const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Descrição'),{target:{value:'Caixa manual'}});
 fireEvent.change(within(dialog).getByLabelText('Quantidade'),{target:{value:'2'}});fireEvent.change(within(dialog).getByLabelText('Paletes'),{target:{value:'1'}});return dialog;}
describe('real preparation panel/hook/outbox to SQL, not HTTP/Auth E2E',()=>{
 it('creates a manual item with labeled fields and acknowledges the real item',async()=>{
  show();const dialog=await manual();fireEvent.click(within(dialog).getByRole('button',{name:/^Adicionar$/}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith({title:'Item adicionado'}));
  expect((await db.query("select count(*)::int n from load_items where item_description='Caixa manual'")).rows[0]).toEqual({n:1});expect(localStorage.length).toBe(0);
 });
 it('recovers a lost creation response after remount using the same request instead of duplicating cargo',async()=>{
  mock.loseReply=true;const view=show();const dialog=await manual();fireEvent.click(within(dialog).getByRole('button',{name:/^Adicionar$/}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'})));
  expect(mock.toast).not.toHaveBeenCalledWith({title:'Item adicionado'});const first=mock.rpc.mock.calls[0][1];view.unmount();show(null);
  fireEvent.click(await screen.findByRole('button',{name:'Recuperar preparação'}));await screen.findByText('Preparação do item confirmada. A carga foi atualizada.');
  expect(mock.rpc.mock.calls[1][1]).toEqual(first);expect((await db.query("select count(*)::int n from load_items where item_description='Caixa manual'")).rows[0]).toEqual({n:1});expect(localStorage.length).toBe(0);
 });
 it('does not silently round fractional pallets or transmit invalid metrics',async()=>{
  show();const dialog=await manual();fireEvent.change(within(dialog).getByLabelText('Paletes'),{target:{value:'1.5'}});
  fireEvent.click(within(dialog).getByRole('button',{name:/^Adicionar$/}));await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'})));
  expect(mock.rpc).not.toHaveBeenCalled();expect(within(dialog).getByLabelText('Paletes')).toHaveValue(1.5);
 });
 it('edits preparation with the expected value and leaves physical outcomes disabled',async()=>{
  show();const select=await screen.findByRole('combobox',{name:'Preparação de Nota original'});
  expect(within(select).getByRole('option',{name:/Entregue — via fluxo operacional/})).toBeDisabled();
  fireEvent.change(select,{target:{value:'loaded'}});
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalled());await waitFor(()=>expect(localStorage.length).toBe(0));
  expect(mock.rpc.mock.calls[0][1]._payload).toMatchObject({item_id:i.item,values:{status:'loaded'},expected:{status:'pending'}});
  expect((await db.query('select status from load_items where id=$1',[i.item])).rows[0]).toEqual({status:'loaded'});
 });
 it('rejects a stale visible field and refreshes without overwriting another operator',async()=>{
  show();const select=await screen.findByRole('combobox',{name:'Preparação de Nota original'});
  await db.query("update load_items set status='picking' where id=$1",[i.item]);fireEvent.change(select,{target:{value:'loaded'}});
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({description:expect.stringContaining('alterado por outra operação')})));
  expect((await db.query('select status from load_items where id=$1',[i.item])).rows[0]).toEqual({status:'picking'});expect(localStorage.length).toBe(0);
 });
 it('rejects manual insertion into a planned load rather than leaving an uncovered item',async()=>{
  await twoPlannedTrips(db);show();const dialog=await manual();fireEvent.click(within(dialog).getByRole('button',{name:/^Adicionar$/}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({description:expect.stringContaining('alocação de parada e entrega')})));
  expect((await db.query('select count(*)::int n from load_items where fiscal_document_id is null')).rows[0]).toEqual({n:0});expect(localStorage.length).toBe(0);
 });
});
