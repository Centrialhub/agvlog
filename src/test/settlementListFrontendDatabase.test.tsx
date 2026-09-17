import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import DriverSettlements from '@/pages/DriverSettlements';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {adjustmentActor} from './helpers/settlementAdjustmentDatabase';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:'',actor:'',aal:'aal1',error:false,wrong:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant?{id:mock.tenant}:null})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor}:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('@/components/financial/DriverSettlementDrawer',()=>({default:({open}:{open:boolean})=>open?<p>Detalhe aberto QA</p>:null}));
vi.mock('@/components/financial/NewManualSettlementDialog',()=>({default:({open}:{open:boolean})=>open?<p>Criação aberta QA</p>:null}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db}=await sessionReadersDatabase());},30000);afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();mock.tenant=i.tenant;mock.actor=i.operator;mock.aal='aal1';mock.error=false;mock.wrong=false;
 await db.exec('begin');await adjustmentActor(db);await manualSettlement(db);client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:120000}}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor,aal=mock.aal;let request:Promise<unknown>|undefined;
  const run=()=>{if(!request){request=transport.then(async()=>{try{
   if(mock.error)return {data:null,error:new Error('Consulta recusada QA')};
   await adjustmentActor(db,actor,aal);let data:unknown;
   if(name==='list_driver_settlements_v2'){
    const keys=['_tenant_id','_search','_driver_id','_vehicle_id','_status','_date_from','_date_to','_only_km_pending','_only_expense_pending','_only_no_freight','_only_needs_recalculation','_snapshot_at','_cursor','_page_size'];
    const values=keys.map(key=>key==='_cursor'?(args[key]?JSON.stringify(args[key]):null):args[key]??null);
    data=(await operationRpc(db,'select list_driver_settlements_v2('+keys.map((_,n)=>n===12?'$13::jsonb':'$'+(n+1)).join(',')+') result',values)).rows[0].result;
    if(mock.wrong){const result=data as {items:Record<string,unknown>[]};result.items[0].tenant_id=i.otherTenant;}
   }else if(name==='list_driver_settlement_filter_options')data=(await operationRpc(db,'select list_driver_settlement_filter_options($1,$2,$3,$4,$5,$6) result',[args._tenant_id,args._kind,args._search,args._page,args._page_size,args._expected_revision])).rows[0].result;
   else throw new Error('Unexpected reader '+name);
   return {data,error:null};
  }catch(error){return {data:null,error};}});transport=request;}return request;};
  return {abortSignal:run,then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');});
const story=()=> <QueryClientProvider client={client}><DriverSettlements/></QueryClientProvider>;
describe('settlement list against the actual SQL readers',()=>{
 it('renders authorized results from the tenant and opens its detail',async()=>{render(story());await screen.findByText('Motorista QA');fireEvent.click(screen.getByRole('button',{name:'Abrir acerto de Motorista QA'}));expect(screen.getByText('Detalhe aberto QA')).toBeInTheDocument();expect(screen.getByText('1 acerto(s)')).toBeInTheDocument();});
 it('does not show cached operator data to a driver in the same tenant',async()=>{const view=render(story());await screen.findByText('Motorista QA');mock.actor=i.user;view.rerender(story());expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();await screen.findByText(/Não foi possível consultar os acertos/);});
 it('hides old rows and totals after a refetch is denied',async()=>{render(story());await screen.findByText('Motorista QA');mock.error=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect(screen.queryByText('1 acerto(s)')).not.toBeInTheDocument();expect(screen.queryByText('Nenhum acerto encontrado.')).not.toBeInTheDocument();});
 it('rejects a response containing a settlement from a different tenant',async()=>{mock.wrong=true;render(story());await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();});
 it('recovers denied reads only after explicit refresh',async()=>{mock.error=true;render(story());await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.getByRole('button',{name:'Novo acerto manual'})).toBeDisabled();mock.error=false;fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByText('Motorista QA');expect(screen.queryByText(/Não foi possível consultar os acertos/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Novo acerto manual'})).toBeEnabled();});
 it('resets dialogs and filters when changing tenant and does not query without an actor',async()=>{const view=render(story());await screen.findByText('Motorista QA');fireEvent.click(screen.getByRole('button',{name:'Novo acerto manual'}));expect(screen.getByText('Criação aberta QA')).toBeInTheDocument();mock.tenant=i.otherTenant;view.rerender(story());expect(screen.queryByText('Criação aberta QA')).not.toBeInTheDocument();await screen.findByText(/Não foi possível consultar os acertos/);mock.rpc.mockClear();mock.actor='';view.rerender(story());expect(screen.getByRole('status')).toHaveTextContent('Selecione uma conta');expect(mock.rpc).not.toHaveBeenCalled();});
 it('searches through the real SQL and distinguishes an empty result from failure',async()=>{render(story());await screen.findByText('Motorista QA');fireEvent.change(screen.getByLabelText('Pesquisar acertos'),{target:{value:'no-such-driver-qa'}});await screen.findByText('Nenhum acerto encontrado.');expect(screen.getByText('0 acerto(s)')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();});
 it('rejects an inverted date range without presenting it as an empty result',async()=>{render(story());await screen.findByText('Motorista QA');fireEvent.change(screen.getByLabelText('Finalizada de'),{target:{value:'2026-09-18'}});fireEvent.change(screen.getByLabelText('Finalizada até'),{target:{value:'2026-09-17'}});expect(await screen.findByRole('alert')).toHaveTextContent('data inicial não pode ser posterior');expect(screen.queryByText('Nenhum acerto encontrado.')).not.toBeInTheDocument();expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();});
 it.each(['driver','client','admin','owner'])('backend denies %s at AAL1',async(role)=>{await expenseMfaRole(db,role);await expect(operationRpc(db,'select list_driver_settlements_v2($1)',[i.tenant])).rejects.toThrow('forbidden');await expect(operationRpc(db,"select list_driver_settlement_filter_options($1,'drivers')",[i.tenant])).rejects.toThrow('forbidden');});
 it('backend permits an AAL2 owner but rejects another tenant and inactive membership',async()=>{await expenseMfaRole(db,'owner');await adjustmentActor(db,i.operator,'aal2');expect((await operationRpc(db,'select list_driver_settlements_v2($1) result',[i.tenant])).rows[0].result).toHaveProperty('total_count',1);await expect(operationRpc(db,'select list_driver_settlements_v2($1)',[i.otherTenant])).rejects.toThrow('forbidden');await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await expect(operationRpc(db,"select list_driver_settlement_filter_options($1,'drivers')",[i.tenant])).rejects.toThrow('forbidden');});
 it('rejects a later page when a settlement changes after the first-page revision',async()=>{await manualSettlement(db);const first=(await operationRpc<{result:{snapshot_at:string;revision:string;next_cursor:Record<string,unknown>}}>(db,'select list_driver_settlements_v2($1,null,null,null,null,null,null,false,false,false,false,null,null,1) result',[i.tenant])).rows[0].result;expect(first.next_cursor).toMatchObject({revision:first.revision});await db.query("update driver_settlements set status='in_review' where tenant_id=$1 and id=$2",[i.tenant,String(first.next_cursor.id)]);await expect(operationRpc(db,'select list_driver_settlements_v2($1,null,null,null,null,null,null,false,false,false,false,$2,$3::jsonb,1)',[i.tenant,first.snapshot_at,JSON.stringify(first.next_cursor)])).rejects.toMatchObject({code:'40001'});});
 it('treats settlement date filters as civil dates in São Paulo',async()=>{const previous=await manualSettlement(db),finalHour=await manualSettlement(db);await db.query("update driver_settlements set trip_completed_at='2026-09-16T23:30:00-03' where id=$1",[previous]);await db.query("update driver_settlements set trip_completed_at='2026-09-17T23:30:00-03' where id=$1",[finalHour]);const result=(await operationRpc<{result:{items:Array<{id:string}>}}>(db,"select list_driver_settlements_v2($1,null,null,null,null,'2026-09-17','2026-09-17') result",[i.tenant])).rows[0].result;expect(result.items.map(row=>row.id)).toContain(finalHour);expect(result.items.map(row=>row.id)).not.toContain(previous);});
 it('pages and searches driver options without returning the full tenant catalog',async()=>{await db.query("insert into drivers(id,tenant_id,name,active) select md5('filter-driver-'||g)::uuid,$1,'Motorista página '||lpad(g::text,2,'0'),true from generate_series(1,60)g",[i.tenant]);const first=(await operationRpc<{result:{total:number;rows:unknown[];revision:string}}>(db,"select list_driver_settlement_filter_options($1,'drivers','Motorista página',1,50,null) result",[i.tenant])).rows[0].result;expect(first).toMatchObject({total:60});expect(first.rows).toHaveLength(50);const second=(await operationRpc<{result:{rows:unknown[];revision:string}}>(db,"select list_driver_settlement_filter_options($1,'drivers','Motorista página',2,50,$2) result",[i.tenant,first.revision])).rows[0].result;expect(second.rows).toHaveLength(10);expect(second.revision).toBe(first.revision);});
});
