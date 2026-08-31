import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import ExpenseApproval from '@/pages/ExpenseApproval';
import {ExpenseReviewRecoveryPanel} from '@/components/financial/ExpenseReviewRecoveryPanel';
import {ExpenseReceiptDialog} from '@/components/financial/ExpenseReceiptDialog';
import {pendingExpenseReview} from '@/lib/financial/expenseReviewOutbox';
import {createExpenseReviewDatabase,expenseAdmin,seedExpense} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),signed:vi.fn(),tenant:'',actor:'',lost:false,wrong:false,delay:false,queryError:false,release:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from,channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:vi.fn(),storage:{from:()=>({createSignedUrl:mock.signed})}}}));
let db:PGlite,trip:string,client:QueryClient;let transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{({db,trip}=await createExpenseReviewDatabase());},30000);afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.operator;mock.lost=false;mock.wrong=false;mock.delay=false;mock.queryError=false;mock.release=null;
 await db.exec('begin');await expenseAdmin(db);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=vi.fn(()=>false);Element.prototype.setPointerCapture=vi.fn();Element.prototype.releasePointerCapture=vi.fn();
 mock.from.mockImplementation(()=>{throw new Error('Expense review must not write tables directly');});
 mock.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/receipt.png'},error:null});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const work=async()=>{try{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let data:unknown;
   if(mock.queryError&&name==='list_driver_expenses_for_review')return {data:null,error:{message:'Falha de consulta QA'}};
   if(name==='list_driver_expenses_for_review')data=(await operationRpc(db,'select list_driver_expenses_for_review($1,$2,$3) result',[args._tenant_id,args._status,args._offset])).rows[0].result;
   else if(name==='get_driver_expense_review_context')data=(await operationRpc(db,'select get_driver_expense_review_context($1,$2) result',[args._tenant_id,args._expense_id])).rows[0].result;
   else if(name==='review_driver_expense')data=(await operationRpc(db,'select review_driver_expense($1::jsonb) result',[JSON.stringify(args._payload)])).rows[0].result;
   else throw new Error('Unexpected expense RPC '+name);
   if(mock.delay&&name==='get_driver_expense_review_context'){mock.delay=false;await new Promise<void>(resolve=>{mock.release=resolve;});}
   if(mock.lost&&name==='review_driver_expense'){mock.lost=false;return {data:null,error:{message:'Resposta perdida após confirmação no banco'}};}
   if(mock.wrong&&name==='review_driver_expense'){mock.wrong=false;data={...data as Record<string,unknown>,expense_id:i.otherTenant};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(work,work);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{mock.release?.();cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({page=true}:{page?:boolean}){return <QueryClientProvider client={client}><ExpenseReviewRecoveryPanel/>{page?<ExpenseApproval/>:null}</QueryClientProvider>;}
const calls=()=>mock.rpc.mock.calls.filter(([name])=>name==='review_driver_expense');
async function openReview(){fireEvent.click(await screen.findByRole('button',{name:'Revisar despesa'}));await screen.findByLabelText('Motivo da revisão');}
function reason(value='Conferência pela operação QA'){fireEvent.change(screen.getByLabelText('Motivo da revisão'),{target:{value}});}
describe('expense approval page with real SQL commands',{timeout:15000},()=>{
 it('approves a company expense and refreshes related modules only after the matching acknowledgement',async()=>{
  const expense=await seedExpense(db,trip,{payment_source:'company_card',reimbursable:false});const invalidate=vi.spyOn(client,'invalidateQueries');render(<Story/>);await openReview();expect(screen.getByRole('button',{name:'Confirmar revisão'})).toBeDisabled();reason();fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText('Revisão confirmada pelo banco.');
  expect((await db.query('select source_id,amount_expected::float amount from financial_obligations')).rows).toEqual([{source_id:expense,amount:25}]);expect(mock.from).not.toHaveBeenCalled();for(const key of ['driver_expenses','driver_settlements','financial_obligations'])expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});await db.exec('set constraints all immediate');
 });
 it('requires an admin, showing a read-only review to operators',async()=>{
  await seedExpense(db,trip);await db.query("update tenant_memberships set role='operator' where user_id=$1",[i.operator]);render(<Story/>);await screen.findByText(/aprovação e a rejeição exigem administrador/);expect(screen.queryByRole('button',{name:'Revisar despesa'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Detalhes da revisão'}));await screen.findByText(/não está disponível para seu papel/);expect(calls()).toHaveLength(0);
 });
 it('rejects with a reason and displays that reason in the reviewed list',async()=>{
  await seedExpense(db,trip);render(<Story/>);await openReview();fireEvent.change(screen.getByLabelText('Decisão'),{target:{value:'reject'}});reason('Documento ilegível; solicitação rejeitada');fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText('Revisão confirmada pelo banco.');fireEvent.click(screen.getByRole('button',{name:'Revisadas'}));await screen.findByText('Motivo da revisão: Documento ilegível; solicitação rejeitada');expect((await db.query('select count(*)::int n from financial_obligations')).rows[0]).toEqual({n:0});
 });
 it('recovers a lost response after leaving the page without creating another review or obligation',async()=>{
  await seedExpense(db,trip,{payment_source:'company_account',reimbursable:false});mock.lost=true;const view=render(<Story/>);await openReview();reason();fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText('Resposta perdida após confirmação no banco');const original=pendingExpenseReview(localStorage,i.tenant,i.operator)!.payload;view.unmount();render(<Story page={false}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar revisão de despesa'}));await screen.findByText(/Revisão recuperada: despesa aprovada/);expect(calls()[1][1]._payload).toEqual(original);expect((await db.query('select count(*)::int n from driver_expense_reviews')).rows[0]).toEqual({n:1});
 });
 it('preserves the reason on stale preview and requires explicit refresh before reconfirming',async()=>{
  const expense=await seedExpense(db,trip);render(<Story/>);await openReview();reason();await db.query('update driver_expenses set amount=30 where id=$1',[expense]);fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText(/A despesa ou o acerto mudou/);expect(screen.getByLabelText('Motivo da revisão')).toHaveValue('Conferência pela operação QA');expect(screen.getByRole('button',{name:'Confirmar revisão'})).toBeDisabled();expect(pendingExpenseReview(localStorage,i.tenant,i.operator)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Atualizar revisão'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar revisão'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText('Revisão confirmada pelo banco.');
 });
 it('sends nothing when durable recovery storage cannot save the command',async()=>{
  await seedExpense(db,trip);render(<Story/>);await openReview();reason();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText(/Recuperação da revisão indisponível/);expect(calls()).toHaveLength(0);
 });
 it('does not expose delayed review data after changing tenant',async()=>{
  await seedExpense(db,trip);mock.delay=true;const view=render(<Story/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar despesa'}));await waitFor(()=>expect(mock.release).not.toBeNull());mock.tenant=i.otherTenant;view.rerender(<Story/>);mock.release?.();await transport;expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(calls()).toHaveLength(0);
 });
 it('treats an acknowledgement for another expense as uncertain rather than success',async()=>{
  await seedExpense(db,trip);mock.wrong=true;render(<Story/>);await openReview();reason();fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText(/A confirmação não corresponde à revisão/);expect(pendingExpenseReview(localStorage,i.tenant,i.operator)).not.toBeNull();expect(screen.queryByText('Revisão confirmada pelo banco.')).not.toBeInTheDocument();
 });
 it('blocks inconsistent payment fields but allows a reasoned rejection',async()=>{
  await seedExpense(db,trip,{paid_with_advance:true});render(<Story/>);await openReview();await screen.findByText(/Origem do pagamento, reembolso e adiantamento divergentes/);reason();expect(screen.getByRole('button',{name:'Confirmar revisão'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Decisão'),{target:{value:'reject'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar revisão'}));await screen.findByText('Revisão confirmada pelo banco.');
 });
 it('shows query failure instead of an empty successful list',async()=>{
  mock.queryError=true;render(<Story/>);await screen.findByText(/Falha ao consultar despesas: Falha de consulta QA/);expect(screen.queryByText('Nenhuma despesa encontrada neste filtro.')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Revisar despesa'})).not.toBeInTheDocument();
 });
 it('reaches expenses beyond the first fifty records',async()=>{
  for(let n=0;n<53;n++)await seedExpense(db,trip);render(<Story/>);await screen.findByText('53 despesas pendentes · página 1');expect(screen.getAllByRole('button',{name:'Revisar despesa'})).toHaveLength(50);fireEvent.click(screen.getByRole('button',{name:'Próxima página'}));await screen.findByText('53 despesas pendentes · página 2');expect(screen.getAllByRole('button',{name:'Revisar despesa'})).toHaveLength(3);
 });
 it('never renders the previous signed receipt under a new path or another actor',async()=>{
  const first=i.tenant+'/one.png',second=i.tenant+'/two.png';mock.signed.mockResolvedValueOnce({data:{signedUrl:'https://example.invalid/one.png'},error:null});
  const view=render(<ExpenseReceiptDialog tenantId={i.tenant} path={first} onClose={()=>{}}/>);await screen.findByRole('img');let release:(value:unknown)=>void=()=>{};mock.signed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));view.rerender(<ExpenseReceiptDialog tenantId={i.tenant} path={second} onClose={()=>{}}/>);expect(screen.queryByRole('img')).not.toBeInTheDocument();
  mock.actor=i.user;view.rerender(<ExpenseReceiptDialog tenantId={i.tenant} path={second} onClose={()=>{}}/>);release({data:{signedUrl:'https://example.invalid/two-old-actor.png'},error:null});await screen.findByRole('img');expect(screen.getByRole('img')).not.toHaveAttribute('src','https://example.invalid/two-old-actor.png');
 });
 it('does not request a receipt from another tenant',async()=>{
  render(<ExpenseReceiptDialog tenantId={i.tenant} path={i.otherTenant+'/receipt.png'} onClose={()=>{}}/>);await screen.findByText('Comprovante fora do escopo da empresa.');expect(mock.signed).not.toHaveBeenCalled();
 });
});
