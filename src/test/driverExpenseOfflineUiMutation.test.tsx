import {QueryClient,QueryClientProvider,onlineManager} from '@tanstack/react-query';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DriverExpenseForm} from '@/components/driver/DriverExpenseForm';
import {DriverExpenseSyncAgent} from '@/components/driver/DriverExpenseSyncAgent';
import {driverExpenseOfflineStore} from '@/lib/driver/driverExpenseOfflineStore';
import {receiptPath,type ExpenseCreationCommand} from '@/lib/financial/expenseCreationCommands';

const state=vi.hoisted(()=>({actor:'a8100000-0000-4000-8000-000000000002',tenant:'a8100000-0000-4000-8000-000000000001',rpc:vi.fn(),upload:vi.fn(),describe:vi.fn()}));
const tenant=state.tenant,actor=state.actor,trip='a8100000-0000-4000-8000-000000000003';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.actor}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:state.tenant,timezone:'America/Sao_Paulo'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:unknown)=>({abortSignal:()=>state.rpc(name,args)})}}));
vi.mock('@/lib/financial/expenseReceiptUpload',()=>({describeExpenseReceipt:(file:File)=>state.describe(file),uploadExpenseReceipt:(p:ExpenseCreationCommand,file:File)=>state.upload(p,file)}));
vi.mock('@/lib/driver/driverExpenseOfflineStore',async importOriginal=>{const actual=await importOriginal<typeof import('@/lib/driver/driverExpenseOfflineStore')>();return {...actual,driverExpenseOfflineStore:actual.createMemoryDriverExpenseOfflineStore()};});
const descriptor={sha256:'b'.repeat(64),mime:'application/pdf',size:4};
const context={version:1,tenant_id:tenant,actor_id:actor,source_type:'trip',source_id:trip,driver_id:actor,driver_name:'Synthetic driver',trip_id:trip,settlement_id:null,manual_settlement_id:null,can_create:true,source_state:'in_transit',revision:'a'.repeat(32)};
let client:QueryClient;
const cacheContext=()=>client.setQueryData(['driver-expense-operational-context',tenant,state.actor,trip],{context:{...context,actor_id:state.actor},offline:!navigator.onLine});
const receiptAck=(p:ExpenseCreationCommand)=>({version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:'trip',source_id:trip,path:receiptPath(p),uploaded:true,receipt:p.receipt});
beforeEach(async()=>{
 vi.clearAllMocks();state.actor=actor;state.tenant=tenant;onlineManager.setOnline(false);vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
 for(const draft of await driverExpenseOfflineStore.list(tenant,actor))await driverExpenseOfflineStore.remove(draft.requestId);
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:Infinity},mutations:{retry:false}}});cacheContext();
 state.describe.mockResolvedValue(descriptor);state.upload.mockImplementation(async p=>receiptAck(p));state.rpc.mockImplementation(async(name,args)=>{
  const p=name==='get_expense_receipt_status'?{...args,tenant_id:args._tenant_id,actor_id:actor,request_id:args._request_id,source_type:'trip',source_id:trip,receipt:args._receipt}:args._payload;
  return {data:name==='get_expense_receipt_status'?{...receiptAck(p),uploaded:false}:{version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:'trip',source_id:trip,expense_id:'a8100000-0000-4000-8000-000000000004',command_id:'a8100000-0000-4000-8000-000000000005',driver_id:actor,status:'pending',confirmed:true,receipt_path:receiptPath(p)},error:null};
 });
});
afterEach(()=>{cleanup();client.clear();onlineManager.setOnline(true);vi.restoreAllMocks();});
function mount(saved=vi.fn()){
 const node=<QueryClientProvider client={client}><DriverExpenseForm sourceId={trip} onSaved={saved}/><DriverExpenseSyncAgent/></QueryClientProvider>;
 const view=render(node);return {saved,rerender:()=>view.rerender(node)};
}
const fill=()=>{const file=new File(['%PDF'],'scanned.pdf',{type:'application/pdf'});fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'18,91'}});fireEvent.change(screen.getByLabelText('Comprovante obrigatório'),{target:{files:[file]}});fireEvent.submit(screen.getByRole('button',{name:'Salvar para sincronizar'}).closest('form')!);return file;};
describe('A8 real QueryClient offline UI mutation (synthetic transport and memory storage)',()=>{
 it('runs offline and acknowledges only after durable command/receipt, without transport',async()=>{
  const {saved}=mount(),file=fill();await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
  const drafts=await driverExpenseOfflineStore.list(tenant,actor);expect(drafts).toHaveLength(1);expect(drafts[0]).toMatchObject({tenantId:tenant,actorId:actor,receipt:{blob:file,name:'scanned.pdf'},payload:{fields:{amount_cents:1891},receipt:descriptor}});
  expect(client.getMutationCache().getAll()[0].state).toMatchObject({status:'success',isPaused:false});expect(screen.queryByRole('button',{name:'Salvando...'})).not.toBeInTheDocument();expect(state.rpc).not.toHaveBeenCalled();expect(state.upload).not.toHaveBeenCalled();
 });
 it('reconnects and replays the original request/payload and receipt once before clearing',async()=>{
  const {saved}=mount();fill();await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));const [original]=await driverExpenseOfflineStore.list(tenant,actor);
  await act(async()=>{vi.spyOn(navigator,'onLine','get').mockReturnValue(true);onlineManager.setOnline(true);window.dispatchEvent(new Event('online'));});
  await waitFor(()=>expect(state.rpc.mock.calls.filter(([name])=>name==='create_driver_expense_command')).toHaveLength(1));
  expect(state.rpc.mock.calls.find(([name])=>name==='create_driver_expense_command')![1]._payload).toEqual(original.payload);expect(state.upload).toHaveBeenCalledTimes(1);expect(state.upload.mock.calls[0][0]).toEqual(original.payload);await waitFor(async()=>expect(await driverExpenseOfflineStore.list(tenant,actor)).toHaveLength(0));
 });
 it('keeps inputs and does not report saved when local storage rejects',async()=>{
  vi.spyOn(driverExpenseOfflineStore,'save').mockRejectedValueOnce(new Error('Armazenamento indisponível.'));const {saved}=mount();fill();
  await screen.findByText('Armazenamento indisponível.');expect(saved).not.toHaveBeenCalled();expect(screen.getByLabelText('Valor (R$)')).toHaveValue('18,91');expect(await driverExpenseOfflineStore.list(tenant,actor)).toHaveLength(0);expect(state.rpc).not.toHaveBeenCalled();expect(state.upload).not.toHaveBeenCalled();
 });
 it('rejects a late acknowledgement after actor changes and leaves the original scoped draft',async()=>{
  let release!:(value:typeof descriptor)=>void;state.describe.mockReturnValueOnce(new Promise(resolve=>{release=resolve;}));const saved=vi.fn(),view=render(<QueryClientProvider client={client}><DriverExpenseForm sourceId={trip} onSaved={saved}/></QueryClientProvider>);fill();await waitFor(()=>expect(state.describe).toHaveBeenCalledTimes(1));
  state.actor='a8100000-0000-4000-8000-000000000009';cacheContext();view.rerender(<QueryClientProvider client={client}><DriverExpenseForm sourceId={trip} onSaved={saved}/></QueryClientProvider>);await act(async()=>release(descriptor));
  await screen.findByText('A sessão mudou. Consulte a fila da sessão original.');expect(saved).not.toHaveBeenCalled();expect(await driverExpenseOfflineStore.list(tenant,actor)).toHaveLength(1);expect(await driverExpenseOfflineStore.list(tenant,state.actor)).toHaveLength(0);expect(state.rpc).not.toHaveBeenCalled();
 });
});
