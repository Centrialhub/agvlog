import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {DriverSettlementDrawer} from '@/components/financial/DriverSettlementDrawer';
import {SettlementAdjustmentRecoveryPanel} from '@/components/financial/SettlementAdjustmentRecoveryPanel';
import {settlementAdjustmentDatabase,adjustmentActor,tripSettlement} from './helpers/settlementAdjustmentDatabase';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {pendingSettlementAdjustment} from '@/lib/financial/settlementAdjustmentOutbox';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',aal:'aal1',lost:false,wrong:false,queryError:false,readError:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useCostCenters',()=>({useCostCenters:()=>({data:[]})}));
vi.mock('@/hooks/useBankReconciliation',()=>({useBankAccounts:()=>({data:[]})}));
vi.mock('@/components/financial/AttachLoadsDialog',()=>({default:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
let db:PGlite,trip:string,client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,trip}=await settlementAdjustmentDatabase());},30000);afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
function queued(work:()=>Promise<unknown>){let promise:Promise<unknown>|undefined;const run=()=>{if(!promise){promise=transport.then(work,work);transport=promise;}return promise;};return {then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>run().then(resolve,reject),abortSignal:run};}
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.aal='aal1';mock.lost=false;mock.wrong=false;mock.queryError=false;mock.readError=false;
 await db.exec('begin');await adjustmentActor(db);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=vi.fn(()=>false);Element.prototype.setPointerCapture=vi.fn();Element.prototype.releasePointerCapture=vi.fn();
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{const actor=mock.actor,aal=mock.aal;return queued(async()=>{try{
  await adjustmentActor(db,actor,aal);let data:unknown;
  if(name==='get_driver_settlement_adjustment_context'){if(mock.queryError)return {data:null,error:{message:'Consulta de ajuste indisponível QA'}};
   data=(await operationRpc(db,'select get_driver_settlement_adjustment_context($1,$2) result',[args._tenant_id,args._settlement_id])).rows[0].result;}
  else if(name==='apply_driver_settlement_adjustment')data=(await operationRpc(db,'select apply_driver_settlement_adjustment($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
  else throw new Error('Unexpected adjustment RPC '+name);
  if(mock.lost&&name==='apply_driver_settlement_adjustment'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
  if(mock.wrong&&name==='apply_driver_settlement_adjustment'){mock.wrong=false;data={...data as Record<string,unknown>,settlement_id:i.otherTenant};}
  return {data,error:null};
 }catch(error){return {data:null,error};}});});
 mock.from.mockImplementation((table:string)=>{
  if(!['driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_payments'].includes(table))throw new Error('Unexpected direct table '+table);
  const filters:Record<string,unknown>={},actor=mock.actor,aal=mock.aal;let single=false;const result=queued(async()=>{try{
   expect(filters.tenant_id).toBeTruthy();expect(filters[table==='driver_settlements'?'id':'settlement_id']).toBeTruthy();
   await adjustmentActor(db,actor,aal);if(mock.readError)return {data:null,error:{message:'Acerto indisponível QA'}};
   const data=(await operationRpc<Record<string,unknown>>(db,'select * from '+table+' where tenant_id=$1 and '+(table==='driver_settlements'?'id':'settlement_id')+'=$2',[filters.tenant_id,filters[table==='driver_settlements'?'id':'settlement_id']])).rows;
   return {data:single?(data[0]?{...data[0],drivers:{name:'Motorista QA'},vehicles:null}:null):data,error:null};
  }catch(error){return {data:null,error};}});
  const builder={select:()=>builder,eq:(key:string,value:unknown)=>{filters[key]=value;return builder;},order:()=>builder,abortSignal:()=>builder,maybeSingle:()=>{single=true;return builder;},then:result.then};return builder;
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({source,drawer=true}:{source:string;drawer?:boolean}){return <QueryClientProvider client={client}><SettlementAdjustmentRecoveryPanel/>{drawer?<DriverSettlementDrawer settlementId={source} open onOpenChange={()=>{}}/>:null}</QueryClientProvider>;}
const calls=()=>mock.rpc.mock.calls.filter(([name])=>name==='apply_driver_settlement_adjustment');
async function tab(){fireEvent.mouseDown(await screen.findByRole('tab',{name:/Ajustes/}),{button:0,ctrlKey:false});await screen.findByRole('button',{name:'Conferir novo ajuste'});}
async function draft(){await tab();fireEvent.click(screen.getByRole('button',{name:'Conferir novo ajuste'}));fireEvent.change(screen.getByLabelText('Valor do ajuste (R$)'),{target:{value:'10,25'}});fireEvent.change(screen.getByLabelText('Descrição do ajuste'),{target:{value:'Diária conferida QA'}});fireEvent.change(screen.getByLabelText('Motivo do ajuste'),{target:{value:'Conferência da operação QA'}});}
describe('real settlement drawer with SQL, recovery and financial readers',{timeout:15000},()=>{
 it('shows unknown planned mileage without presenting it as zero',async()=>{
  const source=await tripSettlement(db,trip);render(<Story source={source}/>);
  expect(await screen.findByText('Sem estimativa validada')).toBeVisible();
  expect(screen.getByText('KM estimado').parentElement).not.toHaveTextContent('0,0 km');
 });
 it.each(['manual','trip'])('adds and removes with labels and refreshes the %s statement',async(type)=>{
  const source=type==='manual'?await manualSettlement(db):await tripSettlement(db,trip),invalidate=vi.spyOn(client,'invalidateQueries');render(<Story source={source}/>);await draft();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText('Ajuste confirmado pelo banco.');
  expect((await db.query<Record<string,unknown>>('select driver_payable_amount::float amount from driver_settlements where id=$1',[source])).rows[0].amount).toBe(10.25);
  fireEvent.click(screen.getByRole('button',{name:'Remover ajuste: Diária conferida QA'}));fireEvent.change(screen.getByLabelText('Motivo do ajuste'),{target:{value:'Remoção justificada em QA'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar remoção do ajuste'}));await screen.findByText('Ajuste confirmado pelo banco.');
  expect((await db.query<Record<string,unknown>>('select driver_payable_amount::float amount from driver_settlements where id=$1',[source])).rows[0].amount).toBe(0);
  for(const key of ['driver_settlement','driver_settlements','driver_expenses'])expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});
  expect((await db.query<Record<string,unknown>>('select count(*)::int n from driver_settlement_payments')).rows[0].n).toBe(0);
 });
 it('recovers a lost acknowledgement inside the drawer and after leaving it',async()=>{
  const source=await manualSettlement(db);mock.lost=true;const view=render(<Story source={source}/>);await draft();fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText('Resposta perdida após confirmação no banco');
  const original=pendingSettlementAdjustment(localStorage,i.tenant,i.operator)!.payload;
  expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Recuperar ajuste do acerto'})).toBeEnabled();view.unmount();render(<Story source={source} drawer={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar ajuste do acerto'}));await screen.findByText('Ajuste recuperado. Consulte o estado atual do acerto.');expect(calls()[1][1]._payload).toEqual(original);
  expect((await db.query<Record<string,unknown>>('select count(*)::int n from driver_settlement_adjustments')).rows[0].n).toBe(1);
 });
 it('preserves draft and demands explicit refresh when source data changes',async()=>{
  const source=await manualSettlement(db);render(<Story source={source}/>);await draft();await db.query("update driver_settlements set km_review_notes='Conferência concorrente' where id=$1",[source]);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText(/O acerto ou seus dados mudaram/);expect(screen.getByLabelText('Descrição do ajuste')).toHaveValue('Diária conferida QA');expect(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Atualizar conferência dos ajustes'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText('Ajuste confirmado pelo banco.');
 });
 it('rejects fractional cents and needs a complete reason',async()=>{
  render(<Story source={await manualSettlement(db)}/>);await draft();fireEvent.change(screen.getByLabelText('Valor do ajuste (R$)'),{target:{value:'0.001'}});expect(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'})).toBeDisabled();expect(calls()).toHaveLength(0);
 });
 it('sends nothing if durable storage fails',async()=>{
  render(<Story source={await manualSettlement(db)}/>);await draft();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText(/Recuperação do ajuste indisponível/);expect(calls()).toHaveLength(0);
 });
 it('keeps an acknowledgement for another settlement uncertain',async()=>{
  mock.wrong=true;render(<Story source={await manualSettlement(db)}/>);await draft();fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText(/A confirmação não corresponde ao ajuste/);expect(pendingSettlementAdjustment(localStorage,i.tenant,i.operator)).not.toBeNull();
 });
 it('hides financial preview on query failure but preserves the draft',async()=>{
  render(<Story source={await manualSettlement(db)}/>);await draft();mock.queryError=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar conferência dos ajustes'}));await screen.findByText(/Falha ao consultar ajustes/);expect(screen.queryByText(/Total a pagar:/)).not.toBeInTheDocument();expect(screen.getByLabelText('Motivo do ajuste')).toHaveValue('Conferência da operação QA');expect(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'})).toBeDisabled();
 });
 it('does not show cached settlement data after changing tenant or actor',async()=>{
  const source=await manualSettlement(db),view=render(<Story source={source}/>);await screen.findByText('Motorista QA');mock.tenant=i.otherTenant;view.rerender(<Story source={source}/>);await screen.findByText('Acerto não encontrado nesta sessão.');expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  mock.tenant=i.tenant;mock.actor=i.user;view.rerender(<Story source={source}/>);await screen.findByText('Acerto não encontrado nesta sessão.');expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
 });
 it('keeps recovery inside the covered drawer after its main read fails',async()=>{
  const source=await manualSettlement(db);render(<Story source={source}/>);await draft();mock.lost=true;mock.readError=true;
  fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));const dialog=within(screen.getByRole('dialog'));
  await dialog.findByText(/Não foi possível consultar o acerto/);fireEvent.click(await dialog.findByRole('button',{name:'Recuperar ajuste do acerto'}));await dialog.findByText('Ajuste recuperado. Consulte o estado atual do acerto.');
  expect((await db.query<{n:number}>('select count(*)::int n from driver_settlement_adjustments')).rows[0].n).toBe(1);expect(pendingSettlementAdjustment(localStorage,i.tenant,i.operator)).toBeNull();
 });
 it('requires MFA even when the form was opened before promotion',async()=>{
  render(<Story source={await manualSettlement(db)}/>);await draft();await expenseMfaRole(db,'admin');fireEvent.click(screen.getByRole('button',{name:'Confirmar inclusão do ajuste'}));await screen.findByText('Confirme a autenticação de dois fatores para ajustar este acerto.');expect((await db.query<Record<string,unknown>>('select count(*)::int n from driver_settlement_adjustments')).rows[0].n).toBe(0);
 });
});
