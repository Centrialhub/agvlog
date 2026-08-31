import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {ReactNode} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import DriverDeliveries from '@/pages/driver/DriverDeliveries';
import {createRedeliveryDatabase,requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
import {seedUndelivered,driverPartial} from './helpers/deliveryAttemptDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {changeDocuments,documentChangePayload} from './helpers/documentChangesDatabase';
import {planningPayload} from './helpers/planningDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),trip:{} as Record<string,unknown>,toast:vi.fn(),tamper:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:i.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:i.user}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useCurrentDriver:()=>({data:{id:i.driver},refetch:vi.fn()}),useActiveTrip:()=>({data:mock.trip,refetch:vi.fn()})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn(),useSearchParams:()=>[new URLSearchParams(),vi.fn()]}));
vi.mock('@/lib/secureUpload',()=>({uploadSecureFile:()=>{throw new Error('No external upload in returned-cargo test');},removeSecureFiles:()=>{throw new Error('No external deletion in returned-cargo test');}}));
vi.mock('@/components/ui/sheet',()=>({
 Sheet:({open,children}:{open:boolean;children:ReactNode})=>open?<section>{children}</section>:null,
 SheetContent:({children}:{children:ReactNode})=><div>{children}</div>,
 SheetHeader:({children}:{children:ReactNode})=><header>{children}</header>,SheetTitle:({children}:{children:ReactNode})=><h2>{children}</h2>,
}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from,
 channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn(),
}}));
let db:PGlite;let trip:string;let stop:string;let client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
const serial=<T,>(work:()=>Promise<T>)=>{const next=transport.then(work,work);transport=next.catch(()=>{});return next;};
async function selectTrip(id:string){mock.trip={...(await db.query<Record<string,unknown>>('select * from dispatch_trips where id=$1',[id])).rows[0],loads:{load_number:'QA'},dispatch_trip_loads:[]};}
beforeAll(async()=>{({db,trip,stop}=await createRedeliveryDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.tamper=false;await db.exec('begin');await selectTrip(trip);
 await db.query("update load_items set item_description=case when id=$1 then 'Item histórico QA' else 'Item pendente QA' end",[i.item]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const response=serial(async()=>{
   try{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);let data:unknown;
    if(name==='get_driver_delivery_items'){
     data=(await operationRpc(db,'select get_driver_delivery_items($1) result',[args._stop_id])).rows[0].result;
     if(mock.tamper)data={...(data as object),trip_id:i.otherTenant};
    }else if(name==='driver_record_delivery_outcome'){
     data=(await operationRpc(db,'select driver_record_delivery_outcome($1,$2,$3::jsonb,$4,$5) result',
      [args._stop_id,args._outcome,JSON.stringify(args._details),args._client_event_id,args._expected_status])).rows[0].result;
     await db.exec('set constraints all immediate;set constraints all deferred');
    }else throw new Error('Unexpected driver RPC '+name);
    return {data,error:null};
   }catch(error){return {data:null,error};}
  });return Object.assign(response,{abortSignal:()=>response});
 });
 mock.from.mockImplementation((table:string)=>{
  if(table!=='dispatch_stops')throw new Error('Unexpected direct driver table read '+table);
  const filters:Record<string,unknown>={};const query={select:()=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query;},order:()=>query,
   then:(resolve:(value:unknown)=>unknown)=>serial(async()=>({data:(await db.query(`select s.*,jsonb_build_object('company_name','Cliente QA') clients,
    '[]'::jsonb dispatch_stop_documents from dispatch_stops s where dispatch_trip_id=$1 and tenant_id=$2 order by stop_order`,
    [filters.dispatch_trip_id,filters.tenant_id])).rows,error:null})).then(resolve)};return query;
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');});
async function openReturn(){
 render(<QueryClientProvider client={client}><DriverDeliveries/></QueryClientProvider>);
 fireEvent.click(await screen.findByRole('button',{name:/Cliente QA/}));fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));
 fireEvent.click(screen.getByRole('button',{name:'DEVOLUÇÃO TOTAL'}));
}
async function submitReturn(){
 fireEvent.click(screen.getByRole('button',{name:'Marcar tudo'}));
 fireEvent.change(screen.getByLabelText('Motivo da devolução'),{target:{value:'Retorno físico conferido QA'}});
 fireEvent.click(screen.getByRole('button',{name:'Lançar evento'}));await screen.findByRole('button',{name:'Ver evento enviado à operação'});
}
describe('driver screen with real attempt readers and delivery RPCs (local fixture, not hosted E2E)',()=>{
 it('finishes the old stop using only its remaining note and preserves the released note',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));await openReturn();
  await screen.findByText('Item pendente QA');expect(screen.queryByText('Item histórico QA')).not.toBeInTheDocument();
  expect(screen.getByText(/Notas já concluídas foram preservadas/)).toBeInTheDocument();await submitReturn();
  const sent=mock.rpc.mock.calls.find(([name])=>name==='driver_record_delivery_outcome')![1];
  expect(sent._details.returned_items).toEqual({[i.item2]:10});
  expect((await db.query('select status from dispatch_trips where id=$1',[trip])).rows[0]).toEqual({status:'completed'});
  expect((await db.query('select status,load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'confirmed',load_id:null});
 });
 it('returns only the newly reserved quantity on the new trip, never the original item ID',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:2});await requestRedelivery(db,await redeliveryPayload(db));
  await changeDocuments(db,await documentChangePayload(db,'attach',i.load2,[i.doc]));
  const p=planningPayload();p.load_ids=[i.load2];p.idempotency_key='bd000000-0000-4000-8000-000000000001';p.stops[0].load_ids=[i.load2];p.stops[0].fiscal_document_ids=[i.doc];
  const id=(await operationRpc<{result:string}>(db,'select dispatch_planned_route($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await operationRpc(db,'select driver_start_trip($1)',[id]);
  await db.query("update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp() where dispatch_trip_id=$1",[id]);await selectTrip(id);
  await openReturn();await screen.findByText('Produto conferido para reentrega QA');expect(screen.queryByText('Item histórico QA')).not.toBeInTheDocument();
  await submitReturn();const sent=mock.rpc.mock.calls.find(([name])=>name==='driver_record_delivery_outcome')![1];
  const newItem=(await db.query<{id:string}>('select id from current_load_items where fiscal_document_id=$1',[i.doc])).rows[0].id;
  expect(newItem).not.toBe(i.item);expect(sent._details.returned_items).toEqual({[newItem]:2});
  expect((await db.query('select count(*)::int n from driver_settlement_payments')).rows[0]).toEqual({n:0});
  expect((await db.query('select quantity::float8 quantity,load_id from load_items where id=$1',[i.item])).rows[0]).toEqual({quantity:10,load_id:i.load});
 });
 it('blocks submission if the reader returns another trip, instead of displaying an empty item list',async()=>{
  mock.tamper=true;await openReturn();await screen.findByText('Não foi possível conferir os itens desta parada e viagem.');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Lançar evento'})).toBeDisabled());
  expect(mock.rpc.mock.calls.filter(([name])=>name==='driver_record_delivery_outcome')).toHaveLength(0);
  mock.tamper=false;fireEvent.click(screen.getByRole('button',{name:'Recarregar itens'}));await screen.findByText('Item pendente QA');
 });
});
