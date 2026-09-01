import {act,cleanup,render,renderHook,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {useCreateOperationalEvent,useUpdateOperationalEvent} from '@/hooks/useOperationalEvents';
import PodHistory from '@/pages/PodHistory';
import {pendingOperationalEventCommand} from '@/lib/operationalEvents/operatorEventOutbox';
import {createOperatorEventDatabase,createOperationalEvent,defaultEventBindings,eventContext,
 eventCreatePayload,operatorEventSql,podHistory,resolveOperationalEvent} from './helpers/operatorEventDatabase';
import {operationIds as i,operationPayload,operationRpc,recordOperation} from './helpers/operationOutcomeDatabase';

// PGlite serializes its init data through File/Blob. JSDOM's implementations
// omit arrayBuffer(), so keep Node's standards-based versions for this suite.
vi.hoisted(async()=>{
 const [{webcrypto},{Blob,File}]=await Promise.all([import('node:crypto'),import('node:buffer')]);
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);
});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',lost:null as null|'create'|'resolve',
 conflict:false,readError:false,podEmpty:false,delayPod:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant,name:'Empresa QA'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));

let db:PGlite,trip:string,stop:string,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,trip,stop}=await createOperatorEventDatabase());},40000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 await db.exec('begin');localStorage.clear();vi.clearAllMocks();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=null;mock.conflict=false;
 mock.readError=false;mock.podEmpty=false;mock.delayPod=false;mock.release=null;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.from.mockImplementation(()=>{throw new Error('Canonical operator flows must not write/read POD tables directly');});
 const enqueue=(work:()=>Promise<unknown>)=>{const task=async()=>{try{return {data:await work(),error:null};}catch(error){return {data:null,error};}};
  const pending=transport.then(task,task);transport=pending;return pending;};
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{let pending:Promise<unknown>|undefined;const run=()=>{
  if(pending)return pending;pending=enqueue(async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[mock.actor]);let data:unknown;
   if(name==='get_operational_event_create_context')data=(await operationRpc(db,'select get_operational_event_create_context($1,$2::jsonb) result',[args._tenant_id,JSON.stringify(args._bindings)])).rows[0].result;
   else if(name==='create_operational_event_v1')data=await createOperationalEvent(db,args._payload);
   else if(name==='get_operational_event_context')data=await eventContext(db,String(args._event_id));
   else if(name==='resolve_operational_event_v1'){
    if(mock.conflict){mock.conflict=false;const payload=args._payload as {event_id:string};await db.query(`insert into client_occurrence_messages(tenant_id,occurrence_id,author_role,message)
      values($1,$2,'client','Atualização concorrente do portal')`,[i.tenant,payload.event_id]);}
    data=await resolveOperationalEvent(db,args._payload);
   }else if(name==='get_operator_pod_history_v1'){
    if(mock.readError)throw new Error('QA histórico indisponível');
    if(mock.delayPod){mock.delayPod=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
    data=await podHistory(db,String(args._document_id));
    if(mock.podEmpty){const row=data as Record<string,unknown>;data={...row,document:{...(row.document as Record<string,unknown>),updated_at:null},
      arrival_without_outcome:false,attempts:[],outcomes:[],proofs:[],allocations:[],occurrences:[]};}
   }else throw new Error('Unexpected operator RPC '+name);
   if(mock.lost===name.replace('_operational_event_v1','') as 'create'|'resolve'){mock.lost=null;throw new Error('Resposta perdida após confirmação no banco');}
   return data;
  });return pending;};return {abortSignal:run,then:(resolve:(value:unknown)=>void,reject:(reason:unknown)=>void)=>run().then(resolve,reject)};});
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();});
const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
const values=()=>({event_type:'other',severity:'medium',description:'Ocorrência criada pelo frontend integrado QA',financial_impact:0,
 visible_to_client:true,client_action_required:true,...defaultEventBindings(trip,stop)});

describe('operator occurrence frontend backed by the real SQL commands',{timeout:20000},()=>{
 it('creates and resolves through context/revision RPCs without direct table writes',async()=>{
  const hook=renderHook(()=>({create:useCreateOperationalEvent(),resolve:useUpdateOperationalEvent()}),{wrapper});let created:Record<string,unknown>={};
  await act(async()=>{created=await hook.result.current.create.mutateAsync(values());});
  await act(async()=>{await hook.result.current.resolve.mutateAsync({id:String(created.event_id),resolution:'Tratativa confirmada pelo frontend QA'});});
  expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_operational_event_create_context','create_operational_event_v1','get_operational_event_context','resolve_operational_event_v1']);
  expect(mock.from).not.toHaveBeenCalled();
  expect((await db.query('select public_status,client_action_required,resolved_at is not null resolved from operational_events where id=$1',[created.event_id])).rows[0])
   .toEqual({public_status:'resolved',client_action_required:false,resolved:true});
 });

 it('recovers the exact create request after a lost acknowledgement without duplication',async()=>{
  mock.lost='create';const hook=renderHook(()=>useCreateOperationalEvent(),{wrapper});
  await act(async()=>{await expect(hook.result.current.mutateAsync(values())).rejects.toThrow('Confirmação pendente');});
  const pending=pendingOperationalEventCommand(localStorage,i.tenant,i.operator)!;expect(pending.action).toBe('create');
  await act(async()=>{await hook.result.current.recoverAsync();});
  const sent=mock.rpc.mock.calls.filter(([name])=>name==='create_operational_event_v1').map(([,args])=>args._payload.request_id);
  expect(sent).toEqual([pending.payload.request_id,pending.payload.request_id]);
  expect((await db.query("select count(*)::int n from operational_events where payload->>'source'='create_operational_event_v1'")).rows[0]).toEqual({n:1});
  expect(pendingOperationalEventCommand(localStorage,i.tenant,i.operator)).toBeNull();
 });

 it('recovers the exact resolution after a lost acknowledgement and keeps the public close atomic',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));mock.lost='resolve';
  const hook=renderHook(()=>useUpdateOperationalEvent(),{wrapper});
  await act(async()=>{await expect(hook.result.current.mutateAsync({id:String(created.event_id),resolution:'Tratativa confirmada com resposta perdida'})).rejects.toThrow('Confirmação pendente');});
  const pending=pendingOperationalEventCommand(localStorage,i.tenant,i.operator)!;expect(pending.action).toBe('resolve');
  expect((await db.query('select public_status,client_action_required,resolved_at is not null resolved from operational_events where id=$1',[created.event_id])).rows[0])
   .toEqual({public_status:'resolved',client_action_required:false,resolved:true});
  await act(async()=>{await hook.result.current.recoverAsync();});
  const sent=mock.rpc.mock.calls.filter(([name])=>name==='resolve_operational_event_v1').map(([,args])=>args._payload.request_id);
  expect(sent).toEqual([pending.payload.request_id,pending.payload.request_id]);
  expect(pendingOperationalEventCommand(localStorage,i.tenant,i.operator)).toBeNull();
 });

 it('fails closed on a stale resolution and clears a deterministic pending command',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));mock.conflict=true;
  const hook=renderHook(()=>useUpdateOperationalEvent(),{wrapper});
  await act(async()=>{await expect(hook.result.current.mutateAsync({id:String(created.event_id),resolution:'Resolução concorrente pelo frontend QA'})).rejects.toThrow(/mudaram ou estão em uso/);});
  expect((await db.query('select resolved_at,public_status from operational_events where id=$1',[created.event_id])).rows[0]).toEqual({resolved_at:null,public_status:'open'});
  expect(pendingOperationalEventCommand(localStorage,i.tenant,i.operator)).toBeNull();
 });
});

function PodStory(){return <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/traceability/${i.doc}/pod`]}><Routes>
 <Route path="/traceability/:docId/pod" element={<PodHistory/>}/></Routes></MemoryRouter></QueryClientProvider>}

describe('canonical POD history screen backed by the real SQL reader',{timeout:20000},()=>{
 it('keeps an arrived stop non-delivered when there is no canonical outcome',async()=>{
  render(<PodStory/>);await screen.findByText('Chegada sem resultado canônico');expect(screen.getAllByText('Pendente')).not.toHaveLength(0);
  expect(screen.queryByText('Entregue')).not.toBeInTheDocument();expect(mock.from).not.toHaveBeenCalled();
 });
 it('renders delivery only after the canonical outcome exists',async()=>{
  await recordOperation(db,await operationPayload(db,stop));render(<PodStory/>);expect(await screen.findAllByText('Entregue')).not.toHaveLength(0);
  expect(screen.getAllByText('Entrega confirmada')).not.toHaveLength(0);
 });
 it('distinguishes loading, error and a confirmed empty timeline',async()=>{
  mock.delayPod=true;const view=render(<PodStory/>);await screen.findByText('Carregando histórico canônico…');mock.release?.();await screen.findByText('Chegada sem resultado canônico');
  mock.readError=true;view.rerender(<PodStory/>);await client.invalidateQueries({queryKey:['pod-history']});await screen.findByText('Histórico indisponível');
  expect(screen.queryByText('Nenhum evento canônico registrado para esta NF.')).not.toBeInTheDocument();
  mock.readError=false;mock.podEmpty=true;await client.invalidateQueries({queryKey:['pod-history']});await screen.findByText('Nenhum evento canônico registrado para esta NF.');
 });
 it('keeps the backend migration contract in the integrated fixture',()=>{expect(operatorEventSql()).toContain('get_operator_pod_history_v1');});
});
