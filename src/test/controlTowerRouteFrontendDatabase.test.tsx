import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import OperationsControl from '@/pages/OperationsControl';
import {controlTowerDatabase,seedTower,towerIds as i,towerRead} from './helpers/controlTowerDatabase';
import {towerEdgeClient} from './helpers/controlTowerEdgeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const state=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),toast:vi.fn(),client:vi.fn(),route:vi.fn(),handler:null as null|((r:Request)=>Promise<Response>),lose:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>state.rpc(...args),functions:{invoke:(...args:unknown[])=>state.invoke(...args)}}}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>state.client()}));
vi.mock('../../supabase/functions/_shared/osrm.ts',()=>({calculateOsrmRoute:(...args:unknown[])=>state.route(...args)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'20000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/useTripOperationalEvents',()=>({useTripOperationalEvents:()=>({data:[],isPending:false,isError:false,refetch:vi.fn()})}));
vi.mock('@/hooks/useTenantCapabilities',()=>({useTenantCapabilities:()=>({isEnabled:()=>false,isError:false})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:state.toast})}));
vi.mock('@/components/control-tower/ControlTowerMap',()=>({default:()=> <div aria-label="Mapa sem rede"/>}));
let db:PGlite,client:QueryClient,serial=Promise.resolve();
const enqueue=<T,>(task:()=>Promise<T>)=>{const next=serial.then(task);serial=next.then(()=>undefined,()=>undefined);return next;};
beforeAll(async()=>{
 db=await controlTowerDatabase();await seedTower(db);
 await db.exec('grant select on tenant_memberships to authenticated;alter table tenant_memberships enable row level security');
 const policy=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').match(/CREATE POLICY "Members can view memberships of their tenants"[\s\S]*?;/)?.[0];
 if(!policy)throw new Error('Missing membership policy');await db.exec(policy);
 vi.stubGlobal('Deno',{env:{get:(key:string)=>key.startsWith('SUPABASE_')?'test':undefined},serve:(h:typeof state.handler)=>{state.handler=h;}});
 const edgePath='../../supabase/functions/calculate-trip-route/index.ts';await import(edgePath);
},20000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 localStorage.clear();await db.exec('begin');state.lose=false;state.toast.mockReset();
 await db.query("insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values($1,$2,-23.1,-46.1,30,now()-interval '1 minute',now())",[i.tenant,i.vehicle]);
 state.client.mockReset().mockImplementation(()=>towerEdgeClient(db));
 state.route.mockReset().mockImplementation(async(coords:{lat:number;lng:number}[])=>({geometryGeoJson:{type:'LineString',coordinates:coords.map(c=>[c.lng,c.lat])},distanceMeters:15000,durationSeconds:900,waypoints:coords.map(c=>({location:[c.lng,c.lat]}))}));
 state.rpc.mockReset().mockImplementation((name:string,args:{_tenant_id:string})=>({abortSignal:()=>enqueue(async()=>{
  await db.exec('savepoint ui_read');try{const data=await towerRead(db,name,args._tenant_id);await db.exec('release ui_read');return {data,error:null};}
  catch(error){await db.exec('rollback to ui_read;release ui_read');return {data:null,error};}
 })}));
 state.invoke.mockReset().mockImplementation((_name:string,args:{body:unknown})=>enqueue(async()=>{
  const response=await state.handler!(new Request('https://edge.example.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(args.body)}));
  if(state.lose && response.ok){state.lose=false;return {data:null,error:new Error('QA lost response after commit')};}
  return {data:await response.json(),error:response.ok?null:new Error('HTTP '+response.status)};
 }));
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external traffic in QA');}));
 client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
});
afterEach(async()=>{cleanup();client.clear();await serial;await db.exec('rollback');vi.restoreAllMocks();});
async function open(){render(<QueryClientProvider client={client}><MemoryRouter><OperationsControl/></MemoryRouter></QueryClientProvider>);fireEvent.click(await screen.findByRole('button',{name:/QA-1234/}));}
const click=()=>fireEvent.click(screen.getByRole('button',{name:'Recalcular rota (OSRM)'}));
async function routes(){return (await db.query('select id,updated_at,plan_revision from trip_routes')).rows;}
describe('route UI → actual Edge → caller-role PostgreSQL, provider mocked',()=>{
 it('commits a current route with SSX still disabled and no external traffic',async()=>{
  await open();click();await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Rota recalculada'})));
  expect(await routes()).toHaveLength(1);expect(state.route).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  expect((await db.query('select enabled from tenant_feature_policy')).rows).toEqual([{enabled:false}]);
 });
 it('recovers a lost commit response after remount without recalculation or rewriting',async()=>{
  state.lose=true;await open();click();await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao calcular rota'})));
  const saved=await routes();expect(saved).toHaveLength(1);const request=state.invoke.mock.calls[0][1].body.request_id;
  cleanup();client.clear();await serial;await open();click();
  await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Rota recalculada'})));
  expect(state.invoke.mock.calls[1][1].body.request_id).toBe(request);expect(state.route).toHaveBeenCalledOnce();expect(await routes()).toEqual(saved);
  expect(localStorage.length).toBe(0);expect((await db.query('select result from control_tower_private.route_calculations')).rows).toHaveLength(1);
 });
 it('shows the actual rejection when a stop changes during routing',async()=>{
  const provider=state.route.getMockImplementation()!;state.route.mockImplementation(async(...args:unknown[])=>{await db.exec('update dispatch_stops set latitude=-22');return provider(...args);});
  await open();click();await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao calcular rota',description:expect.stringMatching(/contexto mudou/)})));
  expect(await routes()).toEqual([]);expect(localStorage.length).toBe(0);
 });
 it('rejects stale GPS before the provider call and preserves a useful error',async()=>{
  await db.exec("update positions_last set captured_at=now()-interval '1 hour'");await open();click();
  await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao calcular rota',description:expect.stringMatching(/GPS válida e recente/)})));
  expect(state.route).not.toHaveBeenCalled();expect(await routes()).toEqual([]);
 });
 it('does not send a calculation if the request cannot be stored durably',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('QA quota');});await open();click();
  await waitFor(()=>expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao calcular rota',description:expect.stringMatching(/Nenhum cálculo foi enviado/)})));
  expect(state.invoke).not.toHaveBeenCalled();expect(state.route).not.toHaveBeenCalled();
 });
});
