import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import LoadReallocation from '@/pages/LoadReallocation';
import {LoadReplanningPanel} from '@/components/loads/LoadReplanningPanel';
import {useLoadReplanning} from '@/hooks/useLoadReplanning';
import {createReplanningDatabase,replanningIds as i,seedReplanning,twoPlannedTrips} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),write:vi.fn(),loseReply:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.operator}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:mock.success,error:mock.error})}));
vi.mock('@/hooks/useLoads',()=>({useLoads:()=>useQuery({queryKey:['loads'],queryFn:async()=> (await db.query('select * from loads order by id')).rows})}));
vi.mock('@/hooks/useLoadItems',()=>({useLoadItems:(loadId:string)=>useQuery({queryKey:['load_items',loadId],enabled:!!loadId,
  queryFn:async()=> (await db.query('select * from load_items where load_id=$1 order by id',[loadId])).rows})}));
vi.mock('@/hooks/useVehicles',()=>({useVehicles:()=>({data:[]})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>{
  const query={select:()=>query,in:()=>Promise.resolve({data:[],error:null}),update:mock.write,delete:mock.write};return query;
}}}));
let db:PGlite;let client:QueryClient;let trips:Awaited<ReturnType<typeof twoPlannedTrips>>;
beforeAll(async()=>{db=await createReplanningDatabase();},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
  vi.clearAllMocks();localStorage.clear();mock.loseReply=false;await seedReplanning(db);trips=await twoPlannedTrips(db);
  await db.query("update loads set load_number=case when id=$1 then '1001' else '1002' end",[i.load]);
  await db.query("update load_items set item_description=case when id=$1 then 'Mercadoria origem' else 'Mercadoria destino' end",[i.item]);
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
  mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
    try {
      let rows:unknown[];
      if(name==='get_load_replanning_context') rows=(await compositionRpc(db,'select get_load_replanning_context($1,$2,$3) result',[args._tenant_id,args._source_load_id,args._target_load_id])).rows;
      else if(name==='replan_load_items') rows=(await compositionRpc(db,'select replan_load_items($1::jsonb) result',[JSON.stringify(args._payload)])).rows;
      else throw new Error('Unexpected mutation: '+name);
      if(name==='replan_load_items' && mock.loseReply){mock.loseReply=false;return {data:{},error:null};}
      return {data:(rows[0] as {result:unknown}).result,error:null};
    }catch(error){return {data:null,error};}
  }}));
});
afterEach(()=>{cleanup();client.clear();});
const show=()=>render(<QueryClientProvider client={client}><MemoryRouter><LoadReallocation/></MemoryRouter></QueryClientProvider>);
async function open(){
  await waitFor(()=>expect(screen.getByLabelText('Carga Origem')).toBeInTheDocument());
  fireEvent.keyDown(screen.getByLabelText('Carga Origem'),{key:'Enter'});fireEvent.click(await screen.findByRole('option',{name:/1001/}));
  fireEvent.keyDown(screen.getByLabelText('Carga Destino'),{key:'Enter'});fireEvent.click(await screen.findByRole('option',{name:/1002/}));
  fireEvent.click(await screen.findByRole('button',{name:/Mercadoria origem/}));
  fireEvent.click(screen.getByRole('button',{name:'Replanejar itens e paradas'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Destino dos itens');return dialog;
}
async function choose(dialog:HTMLElement,name:RegExp){
  fireEvent.keyDown(within(dialog).getByLabelText('Destino dos itens'),{key:'Enter'});
  fireEvent.click(await screen.findByRole('option',{name}));
  fireEvent.change(within(dialog).getByLabelText('Motivo do replanejamento'),{target:{value:'Transferência planejada QA'}});
}
const submitted=()=>mock.rpc.mock.calls.filter(([name])=>name==='replan_load_items');
function StandalonePlanner({source,target}:{source:string;target:string}){
  const api=useLoadReplanning();return <LoadReplanningPanel api={api} sourceId={source} targetId={target}
    itemIds={[source===i.load?i.item:i.item2]} onConfirmed={mock.success}/>;
}
describe('real operational screen -> explicit replanning SQL (local fixture, not HTTP E2E)',()=>{
  it('clears the previous destination and coordinates after switching source and target loads',async()=>{
    const page=(source:string,target:string)=><QueryClientProvider client={client}><StandalonePlanner source={source} target={target}/></QueryClientProvider>;
    const view=render(page(i.load,i.load2));fireEvent.click(screen.getByRole('button',{name:'Replanejar itens e paradas'}));
    let dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Destino dos itens');
    await choose(dialog,/Nova parada com localização/);
    fireEvent.change(within(dialog).getByLabelText('Endereço/destino da nova parada'),{target:{value:'Destino antigo'}});
    fireEvent.change(within(dialog).getByLabelText('Latitude'),{target:{value:'-23.55'}});
    fireEvent.change(within(dialog).getByLabelText('Longitude'),{target:{value:'-46.66'}});
    view.rerender(page(i.load2,i.load));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Replanejar itens e paradas'}));dialog=await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Destino dos itens');await choose(dialog,/Nova parada com localização/);
    expect(within(dialog).getByLabelText('Endereço/destino da nova parada')).toHaveValue('');
    expect(within(dialog).getByLabelText('Latitude')).toHaveValue(null);expect(within(dialog).getByLabelText('Longitude')).toHaveValue(null);
    expect(submitted()).toHaveLength(0);
  });
  it('requires an explicit destination and confirms the actual cross-trip transfer',async()=>{
    show();const dialog=await open();fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escolha explicitamente');expect(submitted()).toHaveLength(0);
    await choose(dialog,/Parada 1: Destino 2/);fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    await waitFor(()=>expect(mock.success).toHaveBeenCalledWith(expect.stringContaining('replanejado')));
    expect(submitted()).toHaveLength(1);expect(mock.write).not.toHaveBeenCalled();
    expect((await db.query('select dispatch_stop_id,load_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0])
      .toEqual({dispatch_stop_id:trips.targetStop,load_id:i.load2});
    expect((await db.query('select status from dispatch_trips where id=$1',[trips.sourceTrip])).rows[0]).toEqual({status:'cancelled'});
  });
  it('recovers the committed transfer after reply loss and remount even though source no longer exists',async()=>{
    mock.loseReply=true;const view=show();const dialog=await open();await choose(dialog,/Parada 1: Destino 2/);
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    await screen.findByRole('button',{name:'Recuperar replanejamento'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.success).not.toHaveBeenCalled();const original=submitted()[0][1];view.unmount();show();
    fireEvent.click(await screen.findByRole('button',{name:'Recuperar replanejamento'}));
    await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));expect(submitted()[1][1]).toEqual(original);
    expect(localStorage.length).toBe(0);
    expect((await db.query("select count(*)::int n from entity_audit_log where action='replan_items_out'")).rows[0]).toEqual({n:1});
  });
  it('adds a new explicitly located stop, without any geocoding/fiscal request',async()=>{
    show();const dialog=await open();await choose(dialog,/Nova parada com localização/);
    fireEvent.change(within(dialog).getByLabelText('Endereço/destino da nova parada'),{target:{value:'Portaria 3'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('latitude e longitude');expect(submitted()).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Latitude'),{target:{value:'-23.55'}});
    fireEvent.change(within(dialog).getByLabelText('Longitude'),{target:{value:'-46.66'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    await waitFor(()=>expect(mock.success).toHaveBeenCalledTimes(1));
    expect((await db.query("select destination,latitude::text,longitude::text from dispatch_stops where destination='Portaria 3'")).rows[0])
      .toEqual({destination:'Portaria 3',latitude:'-23.55',longitude:'-46.66'});expect(mock.write).not.toHaveBeenCalled();
  });
  it('rejects an intervening change and clears only the definitely rolled-back request',async()=>{
    show();const dialog=await open();await choose(dialog,/Parada 1: Destino 2/);
    await db.query("update dispatch_stops set notes='Revisado em outra sessão' where id=$1",[trips.targetStop]);
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirmar replanejamento'}));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('tentativa foi desfeita');
    expect(mock.success).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
    expect((await db.query('select load_id from load_items where id=$1',[i.item])).rows[0]).toEqual({load_id:i.load});
  });
});
