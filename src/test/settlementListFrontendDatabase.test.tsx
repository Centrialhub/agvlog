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
   if(name==='list_driver_settlements'){
    const keys=['_tenant_id','_search','_driver_id','_vehicle_id','_status','_date_from','_date_to','_only_km_pending','_only_expense_pending','_only_no_freight','_only_needs_recalculation','_page','_page_size'];
    data=(await operationRpc(db,'select list_driver_settlements('+keys.map((_,n)=>'$'+(n+1)).join(',')+') result',keys.map(key=>args[key]??null))).rows[0].result;
    if(mock.wrong){const result=data as {items:Record<string,unknown>[]};result.items[0].tenant_id=i.otherTenant;}
   }else if(name==='list_driver_settlement_filter_options')data=(await operationRpc(db,'select list_driver_settlement_filter_options($1) result',[args._tenant_id])).rows[0].result;
   else throw new Error('Unexpected reader '+name);
   return {data,error:null};
  }catch(error){return {data:null,error};}});transport=request;}return request;};
  return {abortSignal:run,then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');});
const story=()=> <QueryClientProvider client={client}><DriverSettlements/></QueryClientProvider>;
describe('settlement list against the actual SQL readers',()=>{
 it('renders authorized results from the tenant and opens its detail',async()=>{render(story());fireEvent.click(await screen.findByText('Motorista QA'));expect(screen.getByText('Detalhe aberto QA')).toBeInTheDocument();expect(screen.getByText('1 acerto(s)')).toBeInTheDocument();});
 it('does not show cached operator data to a driver in the same tenant',async()=>{const view=render(story());await screen.findByText('Motorista QA');mock.actor=i.user;view.rerender(story());expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();await screen.findByText(/Não foi possível consultar os acertos/);});
 it('hides old rows and totals after a refetch is denied',async()=>{render(story());await screen.findByText('Motorista QA');mock.error=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect(screen.queryByText('1 acerto(s)')).not.toBeInTheDocument();expect(screen.queryByText('Nenhum acerto encontrado.')).not.toBeInTheDocument();});
 it('rejects a response containing a settlement from a different tenant',async()=>{mock.wrong=true;render(story());await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();});
 it('recovers denied reads only after explicit refresh',async()=>{mock.error=true;render(story());await screen.findByText(/Não foi possível consultar os acertos/);expect(screen.getByRole('button',{name:'Novo acerto manual'})).toBeDisabled();mock.error=false;fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByText('Motorista QA');expect(screen.queryByText(/Não foi possível consultar os acertos/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Novo acerto manual'})).toBeEnabled();});
 it('resets dialogs and filters when changing tenant and does not query without an actor',async()=>{const view=render(story());await screen.findByText('Motorista QA');fireEvent.click(screen.getByRole('button',{name:'Novo acerto manual'}));expect(screen.getByText('Criação aberta QA')).toBeInTheDocument();mock.tenant=i.otherTenant;view.rerender(story());expect(screen.queryByText('Criação aberta QA')).not.toBeInTheDocument();await screen.findByText(/Não foi possível consultar os acertos/);mock.rpc.mockClear();mock.actor='';view.rerender(story());expect(screen.getByRole('status')).toHaveTextContent('Selecione uma conta');expect(mock.rpc).not.toHaveBeenCalled();});
 it('searches through the real SQL and distinguishes an empty result from failure',async()=>{render(story());await screen.findByText('Motorista QA');fireEvent.change(screen.getByLabelText('Pesquisar acertos'),{target:{value:'no-such-driver-qa'}});await screen.findByText('Nenhum acerto encontrado.');expect(screen.getByText('0 acerto(s)')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();});
 it.each(['driver','client','admin','owner'])('backend denies %s at AAL1',async(role)=>{await expenseMfaRole(db,role);await expect(operationRpc(db,'select list_driver_settlements($1)',[i.tenant])).rejects.toThrow('forbidden');await expect(operationRpc(db,'select list_driver_settlement_filter_options($1)',[i.tenant])).rejects.toThrow('forbidden');});
 it('backend permits an AAL2 owner but rejects another tenant and inactive membership',async()=>{await expenseMfaRole(db,'owner');await adjustmentActor(db,i.operator,'aal2');expect((await operationRpc(db,'select list_driver_settlements($1) result',[i.tenant])).rows[0].result).toHaveProperty('total_count',1);await expect(operationRpc(db,'select list_driver_settlements($1)',[i.otherTenant])).rejects.toThrow('forbidden');await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await expect(operationRpc(db,'select list_driver_settlement_filter_options($1)',[i.tenant])).rejects.toThrow('forbidden');});
});
