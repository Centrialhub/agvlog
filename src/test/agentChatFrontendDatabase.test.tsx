import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import DriverChat from '@/pages/driver/DriverChat';
import OperationalDriverChat from '@/pages/OperationalDriverChat';
import {createOperationalDriverChatDatabase} from './helpers/operationalDriverChatDatabase';
import {installAgentChat,agentActor,agentPayload,agentSend} from './helpers/agentChatDatabase';
import {chatActor,chatIds as i} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';

vi.hoisted(async()=>{const {webcrypto}=await import('node:crypto'),{Blob,File}=await import('node:buffer');vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({actor:'',tenant:'',role:'driver',dropAgent:'',rpc:vi.fn(),channels:new Map<string,()=>void>()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:mock.tenant},currentRole:mock.role,loading:false})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useCurrentDriver:()=>({data:{id:i.driver,name:'Motorista QA',active:true},isPending:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,
 channel:(name:string)=>({name,on(_kind:string,_filter:unknown,callback:()=>void){mock.channels.set(name,callback);return this;},subscribe(callback?:(status:string)=>void){callback?.('SUBSCRIBED');return this;}}),
 removeChannel:(channel:{name:string})=>{mock.channels.delete(channel.name);},
}}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{db=await createOperationalDriverChatDatabase();await installAgentChat(db);},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 await db.exec('begin');vi.clearAllMocks();localStorage.clear();mock.channels.clear();Object.assign(mock,{actor:i.user,tenant:i.tenant,role:'driver',dropAgent:''});
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor,tenant=mock.tenant;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const task=async()=>{try{
   await agentActor(db,actor,tenant);await chatActor(db,actor,'aal2');let sql:string,params:unknown[];
   if(name==='list_operator_reference_page_v1'){sql='select list_operator_reference_page_v1($1,$2,$3,$4,$5::jsonb) r';params=[args._tenant_id,args._resource,args._include_inactive,args._limit,args._cursor==null?null:JSON.stringify(args._cursor)];}
   else if(name==='list_driver_chat_agents'){sql='select list_driver_chat_agents($1,$2) r';params=[args._tenant_id,args._driver_id];}
   else if(name==='list_driver_agent_inbox'){sql='select list_driver_agent_inbox($1,$2::jsonb) r';params=[args._tenant_id,JSON.stringify(args._before)];}
   else if(name==='get_driver_agent_chat_context'){sql='select get_driver_agent_chat_context($1,$2,$3) r';params=[args._tenant_id,args._driver_id,args._agent_user_id];}
   else if(name==='list_driver_agent_chat_messages'){sql='select list_driver_agent_chat_messages($1,$2,$3,$4::jsonb) r';params=[args._tenant_id,args._driver_id,args._agent_user_id,JSON.stringify(args._before)];}
   else if(name==='send_driver_agent_chat_message'){sql='select send_driver_agent_chat_message($1::jsonb) r';params=[JSON.stringify(args._payload)];}
   else if(name==='get_driver_chat_context'){sql='select get_driver_chat_context($1,$2) r';params=[args._tenant_id,args._driver_id];}
   else if(name==='list_driver_chat_messages'){sql='select list_driver_chat_messages($1,$2,$3::jsonb) r';params=[args._tenant_id,args._driver_id,JSON.stringify(args._before)];}
   else if(name==='send_driver_chat_message'){sql='select send_driver_chat_message($1::jsonb) r';params=[JSON.stringify(args._payload)];}
   else throw new Error('Unexpected RPC '+name);
   const data=(await operationRpc(db,sql,params)).rows[0].r;
   const payload=args._payload as {agent_user_id?:string}|undefined;
   if(name==='send_driver_agent_chat_message'&&payload?.agent_user_id===mock.dropAgent){mock.dropAgent='';return {data:null,error:{message:'Resposta perdida QA'}};}
   return {data,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(task,task);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();});
function Story({operation=false}:{operation?:boolean}){return <QueryClientProvider client={client}>{operation?<OperationalDriverChat/>:<DriverChat/>}</QueryClientProvider>;}
async function choose(name:string){fireEvent.click(await screen.findByRole('button',{name:new RegExp('^'+name)}));await screen.findByRole('textbox',{name:'Mensagem'});}
async function send(message:string){fireEvent.change(screen.getByRole('textbox',{name:'Mensagem'}),{target:{value:message}});await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));}
const notify=()=>{for(const callback of mock.channels.values())callback();};
it('selects agents, preserves separate drafts, and completes driver -> selected agent -> driver through actual SQL',async()=>{
 const view=render(<Story/>);await choose('Operação QA');fireEvent.change(screen.getByRole('textbox',{name:'Mensagem'}),{target:{value:'Rascunho operação'}});
 await choose('Admin QA');expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveValue('');
 fireEvent.change(screen.getByRole('textbox',{name:'Mensagem'}),{target:{value:'Rascunho admin'}});
 fireEvent.click(screen.getAllByRole('button',{name:'Operação QA'})[0]);expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveValue('Rascunho operação');
 await send('Mensagem só para operação');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 mock.actor=i.operator;mock.role='operator';view.rerender(<Story operation/>);
 fireEvent.click(await screen.findByRole('button',{name:/Motorista QA Motorista: Mensagem só para operação/}));
 await screen.findByRole('textbox',{name:'Mensagem'});await send('Resposta exclusiva da operação');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 mock.actor=i.user;mock.role='driver';view.rerender(<Story/>);await choose('Operação QA');await within(screen.getByRole('log')).findByText('Resposta exclusiva da operação');
 await choose('Admin QA');expect(within(screen.getByRole('log')).queryByText('Resposta exclusiva da operação')).not.toBeInTheDocument();
 expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages where agent_user_id=$1',[i.operator])).rows[0].n).toBe(2);
});
it('lets a second conversation send while the first acknowledgement is uncertain and recovers only its exact request',async()=>{
 render(<Story/>);await choose('Operação QA');mock.dropAgent=i.operator;await send('Confirmar envio operação');await screen.findByText('Resposta perdida QA');
 await choose('Admin QA');await send('Admin continua independente');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 fireEvent.click(screen.getByRole('button',{name:'Operação QA'}));expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveValue('Confirmar envio operação');
 fireEvent.click(screen.getByRole('button',{name:'Recuperar envio desta conversa'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveValue(''));
 expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(2);
 const attempts=mock.rpc.mock.calls.filter(([name])=>name==='send_driver_agent_chat_message');
 expect(attempts).toHaveLength(3);expect(attempts[0][1]._payload).toEqual(attempts[2][1]._payload);
});
it('refreshes a hidden agent thread after events without mixing messages and isolates tenant switches',async()=>{
 const view=render(<Story/>);await choose('Operação QA');await choose('Admin QA');await transport;
 await agentActor(db,i.operator);await agentSend(db,await agentPayload(db,i.operator,'Recebida ao vivo',i.operator));notify();await screen.findByRole('button',{name:/^Operação QA.*Recebida ao vivo/});
 fireEvent.click(screen.getByRole('button',{name:'Operação QA'}));expect(await within(screen.getByRole('log')).findByText('Recebida ao vivo')).toBeVisible();
 mock.tenant=i.otherTenant;view.rerender(<Story/>);await waitFor(()=>expect(screen.queryByRole('textbox',{name:'Mensagem'})).not.toBeInTheDocument());
 expect(screen.queryByText('Recebida ao vivo')).not.toBeInTheDocument();
});
it('keeps the preserved general-room UI compatible with the new schema without showing private messages',async()=>{
 const view=render(<Story/>);await choose('Operação QA');await send('Conversa pessoal preservada');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 fireEvent.click(screen.getByRole('button',{name:'Operação geral / histórico'}));await screen.findByRole('textbox',{name:'Mensagem'});await send('Assunto para equipe');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
 mock.actor=i.operator;mock.role='operator';view.rerender(<Story operation/>);
 fireEvent.click(screen.getByRole('button',{name:'Operação geral / histórico'}));await screen.findByRole('option',{name:'Motorista QA'});
 fireEvent.change(screen.getByLabelText('Motorista'),{target:{value:i.driver}});await screen.findByRole('textbox',{name:'Mensagem'});
 expect(await within(screen.getByRole('log')).findByText('Assunto para equipe')).toBeVisible();expect(within(screen.getByRole('log')).queryByText('Conversa pessoal preservada')).not.toBeInTheDocument();
 await send('Resposta geral');await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');
});
it('does not expose conversations when a client role is forged in the UI',async()=>{
 mock.actor=i.client;mock.role='operator';render(<Story operation/>);
 await screen.findByText('Não foi possível carregar os motoristas.');
 expect(screen.queryByRole('textbox',{name:'Mensagem'})).not.toBeInTheDocument();
 expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(0);
});
