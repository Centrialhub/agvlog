import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import DriverExpenses from '@/pages/driver/DriverExpenses';
import {ExpenseCreationForm} from '@/components/financial/ExpenseCreationForm';
import {ExpenseCreationRecoveryPanel} from '@/components/financial/ExpenseCreationRecoveryPanel';
import {pendingExpenseCreation} from '@/lib/financial/expenseCreationOutbox';
import {creationCommand,creationPayload,manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseCommand,expensePayload} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {expenseMfaDatabase,expenseMfaActor,expenseMfaRole} from './helpers/expenseMfaDatabase';
const testRuntime=vi.hoisted(async()=>{const BrowserFile=globalThis.File,{Blob,File}=await import('node:buffer'),{webcrypto}=await import('node:crypto');
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);vi.stubGlobal('crypto',webcrypto);return {BrowserFile};});
const mock=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),tenant:'',actor:'',aal:'aal1',lost:false,wrong:false,listError:false,release:null as null|(()=>void),delay:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,functions:{invoke:mock.invoke},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
let db:PGlite,trip:string,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{const {BrowserFile}=await testRuntime;({db,trip}=await expenseMfaDatabase());vi.stubGlobal('File',BrowserFile);},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.user;mock.aal='aal1';mock.lost=false;mock.wrong=false;mock.listError=false;mock.delay=false;mock.release=null;
 await db.exec('begin');await expenseMfaActor(db,i.user);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 Element.prototype.scrollIntoView=vi.fn();
 mock.invoke.mockRejectedValue(new Error('External upload forbidden in this suite'));
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor,aal=mock.aal;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const task=async()=>{try{
   await expenseMfaActor(db,actor,aal);let data:unknown;
   if(mock.listError&&name==='list_driver_expenses')return {data:null,error:{message:'Consulta indisponível QA'}};
   if(name==='get_expense_creation_context')data=(await operationRpc(db,'select get_expense_creation_context($1,$2,$3) result',[args._tenant_id,args._source_type,args._source_id])).rows[0].result;
   else if(name==='create_driver_expense_command')data=(await operationRpc(db,'select create_driver_expense_command($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else if(name==='list_driver_expenses'||name==='list_driver_expense_sources')data=(await operationRpc(db,'select '+name+'($1,$2) result',[args._tenant_id,args._offset])).rows[0].result;
   else if(name==='get_expense_receipt_status')data=(await operationRpc(db,'select get_expense_receipt_status($1,$2,$3,$4,$5::jsonb) result',[args._tenant_id,args._request_id,args._source_type,args._source_id,JSON.stringify(args._receipt)])).rows[0].result;
   else throw new Error('Unexpected RPC '+name);
   if(mock.delay&&name==='get_expense_creation_context'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='create_driver_expense_command'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após registro no banco'}};}
   if(mock.wrong&&name==='create_driver_expense_command'){mock.wrong=false;data={...data as Record<string,unknown>,source_id:i.otherTenant};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};
  pending=transport.then(task,task);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({page=false,source=trip,type='trip',form=true}:{page?:boolean;source?:string;type?:'trip'|'settlement';form?:boolean}){
 return <QueryClientProvider client={client}><ExpenseCreationRecoveryPanel/>{page?<DriverExpenses/>:form?<ExpenseCreationForm sourceId={source} sourceType={type}/>:null}</QueryClientProvider>;
}
const calls=()=>mock.rpc.mock.calls.filter(([name])=>name==='create_driver_expense_command');
async function fill(){
 await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar despesa'})).toBeEnabled());
 fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'25,50'}});
 fireEvent.click(screen.getByLabelText('Sem comprovante'));fireEvent.change(screen.getByLabelText('Motivo da ausência do comprovante'),{target:{value:'Comprovante indisponível em QA'}});
}

describe('MFA expense frontend connected to real SQL',{timeout:15000},()=>{
 it('blocks AAL1 admin creation and resumes after MFA without losing the draft',async()=>{
  const source=await manualSettlement(db);await expenseMfaRole(db,'admin');mock.actor=i.operator;
  render(<Story source={source} type="settlement"/>);
  await screen.findByText(/A política de acesso do servidor está desatualizada/);
  fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'25,50'}});
  expect(screen.getByRole('button',{name:'Registrar despesa'})).toBeDisabled();expect(calls()).toHaveLength(0);
  mock.aal='aal2';fireEvent.click(screen.getByRole('button',{name:'Atualizar contexto da despesa'}));
  await fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'operation'}});
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(1);
 });
 it('disables stale context after revalidation denies MFA and keeps typed fields',async()=>{
  const source=await manualSettlement(db);await expenseMfaRole(db,'admin');mock.actor=i.operator;mock.aal='aal2';
  render(<Story source={source} type="settlement"/>);await fill();mock.aal='aal1';
  fireEvent.click(screen.getByRole('button',{name:'Atualizar contexto da despesa'}));await screen.findByText(/A política de acesso do servidor está desatualizada/);
  expect(screen.getByRole('button',{name:'Registrar despesa'})).toBeDisabled();expect(screen.getByLabelText('Valor (R$)')).toHaveValue('25,50');
  expect(screen.queryByText(/Motorista:/)).not.toBeInTheDocument();expect(calls()).toHaveLength(0);
 });
 it('rejects a downgrade between form preparation and submission without a partial expense',async()=>{
  const source=await manualSettlement(db);await expenseMfaRole(db,'admin');mock.actor=i.operator;mock.aal='aal2';
  render(<Story source={source} type="settlement"/>);await fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'operation'}});mock.aal='aal1';
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText(/A política de acesso do servidor está desatualizada/);
  expect(screen.queryByText('Despesa registrada e aguardando aprovação.')).not.toBeInTheDocument();
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(0);
  expect(screen.getByLabelText('Valor (R$)')).toHaveValue('25,50');
 });
 it('preserves a committed uncertain request through MFA denial and recovers the same command once',async()=>{
  const source=await manualSettlement(db);await expenseMfaRole(db,'admin');mock.actor=i.operator;mock.aal='aal2';mock.lost=true;
  const view=render(<Story source={source} type="settlement"/>);await fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'operation'}});
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Resposta perdida após registro no banco');
  const original=pendingExpenseCreation(localStorage,i.tenant,i.operator)!.payload;view.unmount();client.clear();await transport;
  mock.aal='aal1';render(<Story form={false}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar despesa'}));
  await screen.findByText(/A política de acesso do servidor está desatualizada/);expect(pendingExpenseCreation(localStorage,i.tenant,i.operator)!.payload).toEqual(original);
  mock.aal='aal2';fireEvent.click(screen.getByRole('button',{name:'Recuperar despesa'}));await screen.findByText('Despesa recuperada e confirmada pelo banco.');
  expect(calls()).toHaveLength(3);expect(calls().every(([,args])=>JSON.stringify(args._payload)===JSON.stringify(original))).toBe(true);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(1);
 });
 it('replaces cached driver history with an error after promotion without MFA',async()=>{
  await creationCommand(db,await creationPayload(db,trip));render(<Story page/>);await screen.findByText('1 despesas · página 1');
  await transport;await expenseMfaRole(db,'admin',i.user);await client.invalidateQueries();
  await screen.findByText(/Falha ao consultar despesas: A política de acesso do servidor/);expect(screen.queryByText('1 despesas · página 1')).not.toBeInTheDocument();
 });
 it('shows an AAL2 operation expense reviewed by the same admin in driver history',async()=>{
  const source=await manualSettlement(db);await expenseMfaRole(db,'admin');mock.actor=i.operator;mock.aal='aal2';
  const view=render(<Story source={source} type="settlement"/>);await fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'operation'}});
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');await transport;
  const id=(await db.query<{id:string}>('select id from driver_expenses')).rows[0].id;await expenseCommand(db,await expensePayload(db,id));
  view.unmount();client.clear();mock.actor=i.user;mock.aal='aal1';render(<Story page/>);await screen.findByText('1 despesas · página 1');await screen.findByText(/Aprovada ·/);
 });
});
