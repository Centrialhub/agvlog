import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import DriverChat from '@/pages/driver/DriverChat';
import {DriverConversation} from '@/components/driver/DriverConversation';
import {ChatRecoveryPanel} from '@/components/driver/ChatRecoveryPanel';
import {pendingChat} from '@/lib/driver/chatOutbox';
import {chatActor,chatIds as i,chatPayload,chatSend,createDriverChatDatabase} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer'),{webcrypto}=await import('node:crypto');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);vi.stubGlobal('crypto',webcrypto);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:'',actor:'',lost:false,wrong:false,listError:false,notify:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useCurrentDriver:()=>({data:{id:'60000000-0000-4000-8000-000000000001',name:'Motorista QA'},isPending:false,error:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,channel:()=>({on(_event:string,_filter:unknown,callback:()=>void){mock.notify=callback;return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{db=await createDriverChatDatabase();});afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.user;mock.lost=false;mock.wrong=false;mock.listError=false;mock.notify=null;
 await db.exec('begin');await chatActor(db);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const task=async()=>{try{
   await chatActor(db,actor);let data:unknown;
   if(name==='get_driver_chat_context')data=(await operationRpc(db,'select get_driver_chat_context($1,$2) r',[args._tenant_id,args._driver_id])).rows[0].r;
   else if(name==='list_driver_chat_messages'){if(mock.listError)throw new Error('Leitura de mensagens indisponível QA');data=(await operationRpc(db,'select list_driver_chat_messages($1,$2,$3::jsonb) r',[args._tenant_id,args._driver_id,JSON.stringify(args._before)])).rows[0].r;}
   else if(name==='send_driver_chat_message')data=(await operationRpc(db,'select send_driver_chat_message($1::jsonb) r',[JSON.stringify(args._payload)])).rows[0].r;
   else throw new Error('Unexpected chat RPC '+name);
   if(name==='send_driver_chat_message'&&mock.lost){mock.lost=false;return {data:null,error:{message:'Resposta perdida após registro QA'}};}
   if(name==='send_driver_chat_message'&&mock.wrong){mock.wrong=false;data={...data as Record<string,unknown>,request_id:i.tenant};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(task,task);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({operation=false,show=true}:{operation?:boolean;show?:boolean}){return <QueryClientProvider client={client}><ChatRecoveryPanel/>{show?(operation?<DriverConversation driverId={i.driver}/>:<DriverChat/>):null}</QueryClientProvider>;}
const sends=()=>mock.rpc.mock.calls.filter(([name])=>name==='send_driver_chat_message');
async function compose(text='Mensagem pelo formulário'){await screen.findByLabelText('Mensagem');fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:text}});await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());}
describe('driver and operation chat with actual SQL',{timeout:15000},()=>{
 it('sends from the real driver page and shows the operation reply without forging sender fields',async()=>{
  const view=render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
  expect(screen.getByLabelText('Mensagem')).toHaveValue('');expect(sends()[0][1]._payload).not.toHaveProperty('sender_role');
  mock.actor=i.operator;view.rerender(<Story operation/>);await screen.findByText('Mensagem pelo formulário');await compose('Resposta da operação');fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
  mock.actor=i.user;view.rerender(<Story/>);await screen.findByText('Resposta da operação');expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(2);
 });
 it('keeps text and recovers the exact command after a lost response and remount',async()=>{
  mock.lost=true;const view=render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Resposta perdida após registro QA');
  expect(screen.getByLabelText('Mensagem')).toHaveValue('Mensagem pelo formulário');const original=pendingChat(localStorage,i.tenant,i.user)!.payload;
  view.unmount();render(<Story show={false}/>);fireEvent.click(screen.getByRole('button',{name:'Recuperar mensagem'}));await screen.findByText('Mensagem recuperada e confirmada pelo banco.');
  expect(sends()[1][1]._payload).toEqual(original);expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(1);
 });
 it('preserves the operation draft when context changes and requires explicit refresh',async()=>{
  mock.actor=i.operator;render(<Story operation/>);await compose();await db.query('update profiles set full_name=$1 where id=$2',['Novo nome QA',i.operator]);fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByText(/A conversa mudou ou está em uso/);expect(screen.getByLabelText('Mensagem')).toHaveValue('Mensagem pelo formulário');expect(pendingChat(localStorage,i.tenant,i.operator)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 });
 it('clears the original draft after global recovery so the same message is not inadvertently sent again',async()=>{
  mock.lost=true;render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Resposta perdida após registro QA');
  fireEvent.click(screen.getByRole('button',{name:'Recuperar mensagem'}));await screen.findByText('Mensagem recuperada e confirmada pelo banco.');
  await waitFor(()=>expect(screen.getByLabelText('Mensagem')).toHaveValue(''));expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeDisabled();expect(sends()).toHaveLength(2);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(1);
 });
 it('preserves a new draft edited while the former message awaits recovery',async()=>{
  mock.lost=true;render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Resposta perdida após registro QA');
  fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Próxima mensagem, diferente'}});fireEvent.click(screen.getByRole('button',{name:'Recuperar mensagem'}));await screen.findByText('Mensagem recuperada e confirmada pelo banco.');expect(screen.getByLabelText('Mensagem')).toHaveValue('Próxima mensagem, diferente');
 });
 it('keeps operation history but blocks sending when the recipient membership is revoked',async()=>{
  await chatSend(db,await chatPayload(db,i.user,i.driver,'Mensagem histórica preservada'));await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.user]);
  mock.actor=i.operator;render(<Story operation/>);await screen.findByText('Mensagem histórica preservada');await screen.findByText('O motorista não possui um acesso ativo para receber mensagens.');
  fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Não transmitir'}});expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeDisabled();expect(sends()).toHaveLength(0);
 });
 it('hides previously cached messages after revocation rather than presenting stale access',async()=>{
  await chatSend(db,await chatPayload(db,i.user,i.driver,'Texto antes da revogação'));render(<Story/>);await screen.findByText('Texto antes da revogação');await transport;
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await screen.findAllByText('Sua sessão não tem acesso a esta conversa.');
  expect(screen.queryByText('Texto antes da revogação')).not.toBeInTheDocument();expect(screen.queryByText('Nenhuma mensagem disponível nesta conversa.')).not.toBeInTheDocument();
 });
 it('separates cached data and pending drafts when switching tenant or actor',async()=>{
  await chatSend(db,await chatPayload(db,i.user,i.driver,'Somente sessão original'));const view=render(<Story/>);await screen.findByText('Somente sessão original');await compose('Rascunho privado');
  mock.actor=i.client;view.rerender(<Story/>);await screen.findAllByText('Sua sessão não tem acesso a esta conversa.');expect(screen.queryByText('Somente sessão original')).not.toBeInTheDocument();expect(screen.getByLabelText('Mensagem')).toHaveValue('');
 });
 it('shows a read failure as an error, not a successful empty history',async()=>{
  mock.listError=true;render(<Story/>);await screen.findByText('Leitura de mensagens indisponível QA');expect(screen.queryByText('Nenhuma mensagem disponível nesta conversa.')).not.toBeInTheDocument();
 });
 it('sends nothing when persistence fails and retains mismatched confirmations for recovery',async()=>{
  render(<Story/>);await compose();const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText(/Recuperação do chat indisponível/);expect(sends()).toHaveLength(0);storage.mockRestore();
  mock.wrong=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText(/Mensagem sem confirmação compatível/);expect(pendingChat(localStorage,i.tenant,i.user)).not.toBeNull();
 });
 it('loads messages beyond the first fifty and refreshes after a realtime notification',async()=>{
  for(let n=0;n<51;n++)await chatSend(db,await chatPayload(db,i.user,i.driver,'Histórico QA '+n));render(<Story/>);await screen.findByRole('button',{name:'Carregar mensagens anteriores'});expect(screen.getAllByRole('article')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button',{name:'Carregar mensagens anteriores'}));await waitFor(()=>expect(screen.getAllByRole('article')).toHaveLength(51));await transport;
  await chatActor(db,i.operator);await chatSend(db,await chatPayload(db,i.operator,i.driver,'Nova mensagem em tempo real'));mock.notify?.();await screen.findByText('Nova mensagem em tempo real');
 });
});
