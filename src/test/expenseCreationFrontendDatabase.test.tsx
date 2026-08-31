import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import DriverExpenses from '@/pages/driver/DriverExpenses';
import {ExpenseCreationForm} from '@/components/financial/ExpenseCreationForm';
import {ExpenseCreationRecoveryPanel} from '@/components/financial/ExpenseCreationRecoveryPanel';
import {pendingExpenseCreation} from '@/lib/financial/expenseCreationOutbox';
import {createExpenseCreationDatabase,creationCommand,creationPayload,manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseAdmin,expenseCommand,expensePayload} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {expenseReceiptUpload} from '../../supabase/functions/secure-upload/expense-receipt';
import {readBlobBytes} from '@/lib/uploadPolicy';
import {expenseCreationRelease} from './helpers/expenseCreationRelease';
const testRuntime=vi.hoisted(async()=>{const BrowserFile=globalThis.File,{Blob,File}=await import('node:buffer'),{webcrypto}=await import('node:crypto');
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);vi.stubGlobal('crypto',webcrypto);return {BrowserFile};});
const mock=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),tenant:'',actor:'',lost:false,wrong:false,listError:false,release:null as null|(()=>void),delay:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,functions:{invoke:mock.invoke},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
let db:PGlite,trip:string,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{const {BrowserFile}=await testRuntime;({db,trip}=await createExpenseCreationDatabase());vi.stubGlobal('File',BrowserFile);},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.user;mock.lost=false;mock.wrong=false;mock.listError=false;mock.delay=false;mock.release=null;
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 Element.prototype.scrollIntoView=vi.fn();
 mock.invoke.mockRejectedValue(new Error('External upload forbidden in this suite'));
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const task=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
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
describe('expense creation frontend with actual SQL',{timeout:15000},()=>{
 it('shows containment instead of enabling a new expense',async()=>{
  await expenseCreationRelease(db,'contain');render(<Story/>);await screen.findByText(/Registro de despesas temporariamente suspenso/);
  const submit=screen.getByRole('button',{name:'Registrar despesa'});expect(submit).toBeDisabled();fireEvent.click(submit);expect(calls()).toHaveLength(0);
 });
 it('retains an uncertain committed command during containment and recovers it after resumption',async()=>{
  mock.lost=true;const view=render(<Story/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));
  await screen.findByText('Resposta perdida após registro no banco');const original=pendingExpenseCreation(localStorage,i.tenant,i.user)!.payload;
  view.unmount();client.clear();await transport;await expenseCreationRelease(db,'contain');render(<Story form={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Recuperar despesa'}));await screen.findByText(/Registro de despesas temporariamente suspenso/);
  expect(pendingExpenseCreation(localStorage,i.tenant,i.user)!.payload).toEqual(original);
  await transport;await expenseCreationRelease(db,'resume');fireEvent.click(screen.getByRole('button',{name:'Recuperar despesa'}));
  await screen.findByText('Despesa recuperada e confirmada pelo banco.');expect(calls()).toHaveLength(3);
  expect(calls().every(([,args])=>JSON.stringify(args._payload)===JSON.stringify(original))).toBe(true);
  expect((await db.query('select count(*)::int n from driver_expenses')).rows[0]).toEqual({n:1});
 });
 it('exposes named controls and creates the exact amount through the command',async()=>{
  render(<Story/>);await fill();
  for(const label of ['Categoria','Valor (R$)','Data e hora da despesa','Origem do pagamento','Fornecedor','Nº documento','Cidade','UF','Hodômetro (km)','Observação'])expect(screen.getByLabelText(label)).toHaveAttribute('id');
  expect(screen.getByRole('combobox',{name:'Categoria'})).toBeInTheDocument();expect(screen.getByRole('combobox',{name:'Origem do pagamento'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');
  expect((await db.query('select amount::float amount,no_receipt,approval_status from driver_expenses')).rows).toEqual([{amount:25.5,no_receipt:true,approval_status:'pending'}]);
  expect(mock.invoke).not.toHaveBeenCalled();await db.exec('set constraints all immediate');
 });
 it('records an expense from the actual driver page after selecting its trip',async()=>{
  render(<Story page/>);fireEvent.click(await screen.findByRole('button',{name:'Nova despesa'}));await screen.findByLabelText('Viagem da despesa');
  fireEvent.change(screen.getByLabelText('Viagem da despesa'),{target:{value:trip}});await fill();fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));
  await screen.findByText('Despesa registrada e aguardando aprovação.');await screen.findByText('1 despesas · página 1');expect(calls()).toHaveLength(1);
 });
 it('recovers the same command after leaving the form following a lost response',async()=>{
  mock.lost=true;const view=render(<Story/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));
  await screen.findByText('Resposta perdida após registro no banco');const original=pendingExpenseCreation(localStorage,i.tenant,i.user)!.payload;
  view.unmount();render(<Story form={false}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar despesa'}));await screen.findByText('Despesa recuperada e confirmada pelo banco.');
  expect(calls()[1][1]._payload).toEqual(original);expect((await db.query('select count(*)::int n from driver_expenses')).rows[0]).toEqual({n:1});
 });
 it('manual creation uses the same form and survives administrative approval and API recalculation',async()=>{
  mock.actor=i.operator;await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await expenseAdmin(db);const s=await manualSettlement(db);
  render(<Story source={s} type="settlement"/>);await fill();fireEvent.change(screen.getByLabelText('Centro de custo'),{target:{value:'Operação'}});
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');
  const expense=(await db.query<{id:string}>('select id from driver_expenses')).rows[0].id;await expenseCommand(db,await expensePayload(db,expense));
  await operationRpc(db,'select recalculate_manual_expense_settlement($1,$2)',[i.tenant,s]);
  expect((await db.query('select driver_payable_amount::float amount,needs_recalculation from driver_settlements where id=$1',[s])).rows[0]).toEqual({amount:25.5,needs_recalculation:false});await db.exec('set constraints all immediate');
 });
 it('driver history displays the decision reason written by the operation',async()=>{
  const result=await creationCommand(db,await creationPayload(db,trip));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await expenseAdmin(db);
  const review=await expensePayload(db,result.expense_id,'reject');review.reason='Cupom ilegível, conferir com a operação';await expenseCommand(db,review);
  render(<Story page/>);await screen.findByText('Motivo da revisão: '+review.reason);expect(screen.getByText(/Rejeitada ·/)).toBeInTheDocument();
 });
 it('forces a fresh context after a concurrent change and retains typed fields',async()=>{
  render(<Story/>);await fill();await db.query('update dispatch_trips set notes=$1 where id=$2',['Alteração concorrente',trip]);fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));
  await screen.findByText(/A viagem ou o acerto mudou/);expect(screen.getByLabelText('Valor (R$)')).toHaveValue('25,50');expect(pendingExpenseCreation(localStorage,i.tenant,i.user)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Atualizar contexto da despesa'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar despesa'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');
 });
 it('sends nothing if durable storage is unavailable',async()=>{
  render(<Story/>);await fill();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText(/Recuperação da despesa indisponível/);expect(calls()).toHaveLength(0);
 });
 it('retains a committed command with a mismatched acknowledgement',async()=>{
  mock.wrong=true;render(<Story/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText(/A confirmação não corresponde à despesa/);
  expect(pendingExpenseCreation(localStorage,i.tenant,i.user)).not.toBeNull();expect(screen.queryByText('Despesa registrada e aguardando aprovação.')).not.toBeInTheDocument();
 });
 it('never shows a delayed context after switching tenant',async()=>{
  mock.delay=true;const view=render(<Story/>);await waitFor(()=>expect(mock.release).not.toBeNull());mock.tenant=i.otherTenant;view.rerender(<Story/>);mock.release?.();await transport;
  expect(screen.queryByText(/Motorista:/)).not.toBeInTheDocument();expect(calls()).toHaveLength(0);
 });
 it('shows failed history requests as errors rather than an empty successful list',async()=>{
  mock.listError=true;render(<Story page/>);await screen.findByText(/Consulta indisponível QA/);expect(screen.queryByText(/Nenhuma despesa encontrada/)).not.toBeInTheDocument();
 });
 it('reaches older expenses beyond fifty records',async()=>{
  for(let n=0;n<51;n++)await creationCommand(db,await creationPayload(db,trip));render(<Story page/>);await screen.findByText('51 despesas · página 1');fireEvent.click(screen.getByRole('button',{name:'Próxima página'}));await screen.findByText('51 despesas · página 2');expect(screen.getAllByText('Alimentação')).toHaveLength(1);
 });
 it('sends real browser file bytes through the gateway contract and binds the SQL expense to the scanned object',async()=>{
  const scans=vi.fn(async()=>({available:true,clean:true}));
  mock.invoke.mockImplementation(async(name:string,{body}:{body:FormData})=>{
   expect(name).toBe('secure-upload');const file=body.get('file') as File,bytes=await readBlobBytes(file);
   const result=await expenseReceiptUpload({tenant:String(body.get('tenant_id')),actor:mock.actor,request:String(body.get('request_id')),sourceType:String(body.get('source_type')),sourceId:String(body.get('source_id')),declaredHash:String(body.get('sha256')),mime:file.type,bytes},{
    inspect:async args=>({data:(await db.query<{result:unknown}>('select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[args._tenant_id,args._actor_id,args._request_id,args._source_type,args._source_id,JSON.stringify(args._receipt)])).rows[0].result,error:null}),
    scan:scans,upload:async(path,_bytes,options)=>{await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[path,JSON.stringify(options.metadata)]);return {error:null};},
   });return {data:result.body,error:result.status===200?null:{message:'Unconfirmed'}};
  });
  render(<Story/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar despesa'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'12,34'}});
  fireEvent.change(screen.getByLabelText('Comprovante (imagem ou PDF)'),{target:{files:[new File([new Uint8Array([137,80,78,71,13,10,26,10])],'qa.png',{type:'image/png'})]}});
  fireEvent.click(screen.getByRole('button',{name:'Registrar despesa'}));await screen.findByText('Despesa registrada e aguardando aprovação.');
  expect(scans).toHaveBeenCalledTimes(1);expect((await db.query('select receipt_url,no_receipt,amount::float amount from driver_expenses')).rows[0]).toMatchObject({no_receipt:false,amount:12.34,receipt_url:expect.stringContaining('/expense-receipts/'+i.user+'/')});
  await db.exec('set constraints all immediate');
 });
});
