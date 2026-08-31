import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {useDispatchRoutePlan,type DispatchRoutePayload} from '@/hooks/route-planning/useDispatchRoutePlan';
import DispatchRecoveryPanel from '@/components/route-planning/DispatchRecoveryPanel';
import {createPlanningDatabase,dispatchPlanning,planningIds as i,planningPayload,seedPlanning} from './helpers/planningDatabase';

const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:'',actor:'',loseReply:false}));
// PGlite dumpDataDir creates a File during initdb, then loadTar requires its
// arrayBuffer(). JSDOM File/Blob omit it; supply the Node standard implementations.
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
let db:PGlite;let client:QueryClient;
beforeAll(async()=>{db=await createPlanningDatabase({candidate:true});});
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
  await seedPlanning(db);localStorage.clear();vi.clearAllMocks();mock.tenant=i.tenant;mock.actor=i.operator;mock.loseReply=false;
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  mock.rpc.mockImplementation((name:string,args:{_payload:unknown})=>({abortSignal:async()=>{
    expect(name).toBe('dispatch_planned_route');
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',mock.actor]);
    try{
      const id=await dispatchPlanning(db,args._payload);
      if(mock.loseReply){mock.loseReply=false;return {data:null,error:{message:'Resposta perdida depois do commit'}};}
      return {data:id,error:null};
    }catch(error){return {data:null,error};}
  }}));
});
afterEach(()=>{cleanup();client.clear();});
const payload=():DispatchRoutePayload=>{
  const planned=planningPayload();return {...planned,attempt_scope:'route',planning_draft_id:i.draft,
    stops:planned.stops.map((stop,n)=>({...stop,id:String(n),recipient_name:'Cliente QA',invoice_numbers:[],total_weight_kg:10,
      total_pallet_count:1,total_volume_m3:1,total_value:0,priority:0,risk_level:'normal' as const}))};
};
function DriverPlanningHarness(){
  const dispatch=useDispatchRoutePlan();const [trip,setTrip]=useState('');const [error,setError]=useState('');
  return <><button disabled={dispatch.isPending} onClick={async()=>{
    setError('');try{setTrip(await dispatch.mutateAsync(payload()));}catch(caught){setError(caught instanceof Error?caught.message:'Erro');}
  }}>Despachar rota QA</button>{trip?<output aria-label="Viagem confirmada">{trip}</output>:null}
    {error?<p role="alert">{error}</p>:null}<DispatchRecoveryPanel onConfirmed={(_attempt,id)=>{setTrip(id);setError('');}}/></>;
}
const show=()=>render(<QueryClientProvider client={client}><DriverPlanningHarness/></QueryClientProvider>);
const count=async(table:string)=>Number((await db.query<{count:number}>(`select count(*)::int count from public.${table}`)).rows[0].count);

describe('real frontend submission and candidate PostgreSQL contract (not hosted Auth/browser E2E)',()=>{
  it('recovers a committed route after a lost reply and remount without duplicating its graph',async()=>{
    mock.loseReply=true;const view=show();fireEvent.click(screen.getByRole('button',{name:'Despachar rota QA'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta perdida');expect(screen.queryByLabelText('Viagem confirmada')).not.toBeInTheDocument();
    expect(await count('dispatch_trips')).toBe(1);const request=mock.rpc.mock.calls[0][1];view.unmount();show();
    fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    const output=await screen.findByLabelText('Viagem confirmada');
    const trip=(await db.query<{id:string}>('select id from public.dispatch_trips')).rows[0].id;
    expect(output).toHaveTextContent(trip);expect(mock.rpc.mock.calls[1][1]).toEqual(request);expect(localStorage.length).toBe(0);
    for(const [table,expected] of [['dispatch_trips',1],['dispatch_trip_loads',1],['dispatch_stops',1],['dispatch_stop_documents',2],
      ['idempotency_keys',1],['driver_settlements',0],['driver_settlement_payments',0]] as const)expect(await count(table)).toBe(expected);
    expect((await db.query<{status:string}>('select status from public.route_planning_drafts')).rows[0].status).toBe('dispatched');
  });
  it('keeps a held load unchanged, permits correction after definite rollback and then confirms one trip',async()=>{
    await db.query('update public.loads set on_hold=true where id=$1',[i.load]);show();
    fireEvent.click(screen.getByRole('button',{name:'Despachar rota QA'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('load_not_eligible_for_dispatch');
    expect(await count('dispatch_trips')).toBe(0);expect(localStorage.length).toBe(0);
    await db.query('update public.loads set on_hold=false where id=$1',[i.load]);
    fireEvent.click(screen.getByRole('button',{name:'Despachar rota QA'}));await screen.findByLabelText('Viagem confirmada');
    expect(mock.rpc.mock.calls[1][1]._payload.idempotency_key).not.toBe(mock.rpc.mock.calls[0][1]._payload.idempotency_key);
    expect(await count('dispatch_trips')).toBe(1);
  });
  it('preserves an ambiguous request if operator membership is revoked before recovery',async()=>{
    mock.loseReply=true;show();fireEvent.click(screen.getByRole('button',{name:'Despachar rota QA'}));await screen.findByRole('alert');
    await db.query('update public.tenant_memberships set active=false where user_id=$1',[i.operator]);
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));});
    await waitFor(()=>expect(screen.getAllByRole('alert').some(node=>node.textContent?.includes('not_authorized'))).toBe(true));
    expect(await count('dispatch_trips')).toBe(1);expect(localStorage.length).toBe(1);expect(screen.queryByLabelText('Viagem confirmada')).not.toBeInTheDocument();
  });
});
