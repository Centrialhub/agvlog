import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import DriverEventDetail from '@/pages/driver/DriverEventDetail';
import DriverIssues from '@/pages/driver/DriverIssues';
import {EventConversation} from '@/components/driver/DriverConversation';
import {ChatRecoveryPanel} from '@/components/driver/ChatRecoveryPanel';
import {pendingChat} from '@/lib/driver/chatOutbox';
import {createEventChatDatabase,eventChatIds as i,eventPayload,eventSend} from './helpers/eventChatDatabase';
import {chatActor} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer'),{webcrypto}=await import('node:crypto');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);vi.stubGlobal('crypto',webcrypto);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:'',actor:'',lost:false,wrong:false,readError:false,notify:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useActiveTrip:()=>({data:null}),useCurrentDriver:()=>({data:{id:mock.actor==='10000000-0000-4000-8000-000000000004'?'60000000-0000-4000-8000-000000000002':'60000000-0000-4000-8000-000000000001'},isPending:false,error:null,refetch:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from,channel:()=>({on(_event:string,_filter:unknown,callback:()=>void){mock.notify=callback;return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{db=await createEventChatDatabase(true);});afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();mock.tenant=i.tenant;mock.actor=i.user;mock.lost=false;mock.wrong=false;mock.readError=false;mock.notify=null;
 await db.exec('begin');await chatActor(db);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 const enqueue=(actor:string,work:()=>Promise<unknown>)=>{const task=async()=>{try{await chatActor(db,actor);return {data:await work(),error:null};}catch(error){return {data:null,error};}};const p=transport.then(task,task);transport=p;return p;};
 mock.from.mockImplementation((table:string)=>{if(table!=='operational_events')throw Error('Unexpected table');const filters:Record<string,string>={},actor=mock.actor;
  return {select(){return this;},eq(key:string,value:string){filters[key]=value;return this;},order(){return this;},limit:()=>enqueue(actor,async()=>{if(mock.readError)throw Error('QA leitura indisponível');return (await operationRpc(db,'select * from operational_events where tenant_id=$1 and driver_id=$2 order by created_at desc limit 20',[filters.tenant_id,filters.driver_id])).rows;}),maybeSingle:()=>enqueue(actor,async()=>{if(mock.readError)throw Error('QA leitura indisponível');return (await operationRpc(db,'select id,event_type,report_details,payload,description,created_at from operational_events where id=$1 and tenant_id=$2',[filters.id,filters.tenant_id])).rows[0]??null;})};
 });
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;pending=enqueue(actor,async()=>{
   if(mock.readError&&name!=='send_event_chat_message')throw Error('QA leitura indisponível');let data:unknown;
   if(name==='get_event_chat_context')data=(await operationRpc(db,'select get_event_chat_context($1,$2) r',[args._tenant_id,args._event_id])).rows[0].r;
   else if(name==='list_event_chat_messages')data=(await operationRpc(db,'select list_event_chat_messages($1,$2,$3::jsonb) r',[args._tenant_id,args._event_id,JSON.stringify(args._before)])).rows[0].r;
   else if(name==='send_event_chat_message')data=(await operationRpc(db,'select send_event_chat_message($1::jsonb) r',[JSON.stringify(args._payload)])).rows[0].r;
   else throw Error('Unexpected event chat RPC '+name);
   if(name==='send_event_chat_message'&&mock.lost){mock.lost=false;throw Error('Resposta perdida após registro QA');}
   if(name==='send_event_chat_message'&&mock.wrong){mock.wrong=false;data={...data as Record<string,unknown>,event_id:i.peerEvent};}
   return data;
  });return pending;};return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({operation=false,issues=false,event=i.event,show=true}:{operation?:boolean;issues?:boolean;event?:string;show?:boolean}){return <QueryClientProvider client={client}><ChatRecoveryPanel/>{show?(operation?<EventConversation eventId={event}/>:issues?<DriverIssues/>:<MemoryRouter initialEntries={['/driver/events/'+event]}><Routes><Route path="/driver/events/:id" element={<DriverEventDetail/>}/></Routes></MemoryRouter>):null}</QueryClientProvider>;}
const sends=()=>mock.rpc.mock.calls.filter(([name])=>name==='send_event_chat_message');
async function compose(text='Mensagem pelo detalhe da ocorrência'){await screen.findByLabelText('Mensagem');fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:text}});await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());}
describe('event chat frontend connected to actual SQL',{timeout:15000},()=>{
 it('opens the actual DriverIssues sheet and recovers a lost confirmation inside the modal',async()=>{
  mock.lost=true;render(<Story issues/>);fireEvent.click(await screen.findByRole('button',{name:/Ocorrência QA/}));expect(screen.getByRole('dialog',{name:'Comunicação com a operação'})).toHaveAccessibleDescription('Ocorrência QA');await compose('Mensagem pelo painel de ocorrências');fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Resposta perdida após registro QA');
  fireEvent.click(screen.getByRole('button',{name:'Recuperar envio desta conversa'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');expect(screen.getByLabelText('Mensagem')).toHaveValue('');expect((await db.query<{n:number}>('select count(*)::int n from operational_event_messages')).rows[0].n).toBe(1);
 });
 it('does not call a failed occurrence listing an empty success and can retry it',async()=>{
  mock.readError=true;render(<Story issues/>);await screen.findByText('Não foi possível consultar as ocorrências.');expect(screen.queryByText('Nenhuma ocorrência registrada.')).not.toBeInTheDocument();mock.readError=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByRole('button',{name:/Ocorrência QA/});
 });
 it('sends from the actual driver event detail and receives an operation reply on the same event',async()=>{
  const view=render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');expect(sends()[0][1]._payload).toMatchObject({event_id:i.event,driver_id:i.driver});
  mock.actor=i.operator;view.rerender(<Story operation/>);await screen.findByText('Mensagem pelo detalhe da ocorrência');await compose('Resposta referente a esta ocorrência');fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');mock.actor=i.user;view.rerender(<Story/>);await screen.findByText('Resposta referente a esta ocorrência');
 });
 it('recovers the exact event request after a lost response without duplicating or keeping the original draft',async()=>{
  mock.lost=true;render(<Story/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Resposta perdida após registro QA');const original=pendingChat(localStorage,i.tenant,i.user)!.payload;
  fireEvent.click(screen.getByRole('button',{name:'Recuperar mensagem'}));await screen.findByText('Mensagem recuperada e confirmada pelo banco.');expect(sends()[1][1]._payload).toEqual(original);await waitFor(()=>expect(screen.getByLabelText('Mensagem')).toHaveValue(''));expect((await db.query<{n:number}>('select count(*)::int n from operational_event_messages')).rows[0].n).toBe(1);
 });
 it('clearly identifies and accepts an internal-only conversation with no driver',async()=>{
  mock.actor=i.operator;render(<Story operation event={i.unassignedEvent}/>);await screen.findByText('Conversa interna da operação — nenhum motorista recebe estas mensagens.');await compose('Discussão interna');fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');expect(sends()[0][1]._payload).toMatchObject({driver_id:null,event_id:i.unassignedEvent});
 });
 it('rejects a confirmation from another event and recovers the original occurrence after navigation',async()=>{
  mock.actor=i.operator;mock.wrong=true;const view=render(<Story operation/>);await compose();fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText(/Resposta do chat incompatível/);const original=pendingChat(localStorage,i.tenant,i.operator)!.payload;
  view.rerender(<Story operation event={i.peerEvent}/>);await screen.findByLabelText('Mensagem');fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Outra ocorrência'}});expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Recuperar mensagem'}));await screen.findByText('Mensagem recuperada e confirmada pelo banco.');expect(sends()[1][1]._payload).toEqual(original);expect(screen.getByLabelText('Mensagem')).toHaveValue('Outra ocorrência');
 });
 it('preserves the draft after recipient reassignment and requires explicit context refresh',async()=>{
  mock.actor=i.operator;render(<Story operation/>);await compose();await db.query('update operational_events set driver_id=$1 where id=$2',[i.peerDriver,i.event]);fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText(/A conversa mudou ou está em uso/);expect(screen.getByLabelText('Mensagem')).toHaveValue('Mensagem pelo detalhe da ocorrência');fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await screen.findByText(/Conversa da ocorrência com Colega QA/);await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());
 });
 it('denies the reassigned trip driver the original event detail and messages',async()=>{
  await eventSend(db,await eventPayload(db,i.user,i.event,'Conteúdo do motorista anterior'));await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.peerDriver,i.trip]);mock.actor=i.peerUser;render(<Story/>);await screen.findByText('Evento não encontrado');expect(screen.queryByText('Conteúdo do motorista anterior')).not.toBeInTheDocument();expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
 });
 it('hides cached content on revocation and does not treat read errors as empty history',async()=>{
  await eventSend(db,await eventPayload(db));const view=render(<Story/>);await screen.findByText('Mensagem da ocorrência');await transport;await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);await client.invalidateQueries();await waitFor(()=>expect(screen.queryByText('Mensagem da ocorrência')).not.toBeInTheDocument());
  mock.actor=i.operator;mock.readError=true;view.rerender(<Story operation/>);await screen.findAllByText('QA leitura indisponível');expect(screen.queryByText('Nenhuma mensagem disponível nesta conversa.')).not.toBeInTheDocument();
 });
 it('offers a retry for a failed driver detail read without showing not-found',async()=>{
  mock.readError=true;render(<Story/>);await screen.findByText('Não foi possível consultar a ocorrência. Tente novamente.');expect(screen.queryByText('Evento não encontrado')).not.toBeInTheDocument();mock.readError=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByLabelText('Mensagem');
 });
 it('shows and blocks a revoked recipient and refreshes messages after realtime notification',async()=>{
  mock.actor=i.operator;render(<Story operation/>);await compose();await transport;await chatActor(db);await eventSend(db,await eventPayload(db,i.user,i.event,'Atualização da ocorrência'));mock.notify?.();await screen.findByText('Atualização da ocorrência');await transport;
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await screen.findByText('O motorista não possui um acesso ativo para receber mensagens.');expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeDisabled();
 });
});
