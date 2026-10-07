import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import OperationalDriverChat from '@/pages/OperationalDriverChat';
import DriverChat from '@/pages/driver/DriverChat';
import {SidebarNavigation} from '@/components/layout/SidebarNavigation';
import {TooltipProvider} from '@/components/ui/tooltip';
import {createOperationalDriverChatDatabase} from './helpers/operationalDriverChatDatabase';
import {chatActor,chatIds as i,chatPayload,chatSend} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';

vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer'),{webcrypto}=await import('node:crypto');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);vi.stubGlobal('crypto',webcrypto);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:'',actor:'',role:'operator',loading:false,catalogError:false,notify:null as null|(()=>void)}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant?{id:mock.tenant}:null,currentRole:mock.role,loading:mock.loading})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor}:null})}));
vi.mock('@/hooks/useCurrentDriver',()=>({useCurrentDriver:()=>({data:{id:'60000000-0000-4000-8000-000000000001',name:'Motorista QA'},isPending:false,error:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,channel:()=>({on(_event:string,_filter:unknown,callback:()=>void){mock.notify=callback;return this;},subscribe(){return this;}}),removeChannel:vi.fn()}}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
beforeAll(async()=>{db=await createOperationalDriverChatDatabase();});afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();Object.assign(mock,{tenant:i.tenant,actor:i.operator,role:'operator',loading:false,catalogError:false,notify:null});
 await db.exec('begin');client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const actor=mock.actor;let pending:Promise<unknown>|undefined;
  const run=()=>{if(pending)return pending;const task=async()=>{try{
   await chatActor(db,actor);let sql:string,params:unknown[];
   if(name==='list_operator_reference_page_v1'){
    if(mock.catalogError)throw Error('QA catalog unavailable');
    sql='select list_operator_reference_page_v1($1,$2,$3,$4,$5::jsonb) r';params=[args._tenant_id,args._resource,args._include_inactive,args._limit,args._cursor == null ? null : JSON.stringify(args._cursor)];
   }else if(name==='get_driver_chat_context'){sql='select get_driver_chat_context($1,$2) r';params=[args._tenant_id,args._driver_id];}
   else if(name==='list_driver_chat_messages'){sql='select list_driver_chat_messages($1,$2,$3::jsonb) r';params=[args._tenant_id,args._driver_id,JSON.stringify(args._before)];}
   else if(name==='send_driver_chat_message'){sql='select send_driver_chat_message($1::jsonb) r';params=[JSON.stringify(args._payload)];}
   else throw Error('Unexpected RPC '+name);
   return {data:(await operationRpc(db,sql,params)).rows[0].r,error:null};
  }catch(error){return {data:null,error};}};pending=transport.then(task,task);transport=pending;return pending;};
  return {abortSignal:run,then:(resolve:()=>void,reject:()=>void)=>run().then(resolve,reject)};
 });
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();vi.restoreAllMocks();});
function Story({driver=false}:{driver?:boolean}){return <MemoryRouter><QueryClientProvider client={client}><TooltipProvider><SidebarNavigation query="chat" capabilityAvailable={()=>true}/>{driver?<DriverChat/>:<OperationalDriverChat/>}</TooltipProvider></QueryClientProvider></MemoryRouter>;}
async function selectDriver(){await screen.findByRole('option',{name:'Motorista QA'});fireEvent.change(screen.getByLabelText('Motorista'),{target:{value:i.driver}});await screen.findByLabelText('Mensagem');}
async function send(text:string){fireEvent.change(await screen.findByLabelText('Mensagem'),{target:{value:text}});await waitFor(()=>expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));await screen.findByText('Mensagem registrada no servidor. Isso não confirma a leitura.');}

describe('general operation driver chat with actual catalog/chat SQL',{timeout:20000},()=>{
 it('is reachable in the operation menu without any occurrence and completes driver -> operation -> driver',async()=>{
  expect((await db.query<{present:string|null}>("select to_regclass('public.operational_events') present")).rows[0].present).toBeNull();
  mock.actor=i.user;mock.role='driver';const view=render(<Story driver/>);await send('Motorista iniciou conversa');
  mock.actor=i.operator;mock.role='operator';view.rerender(<Story/>);expect(screen.getByRole('link',{name:'Chat com motoristas'})).toHaveAttribute('href','/driver-chat');
  await selectDriver();await screen.findByText('Motorista iniciou conversa');await send('Operação respondeu');
  mock.actor=i.user;mock.role='driver';view.rerender(<Story driver/>);await screen.findByText('Operação respondeu');
  const rows=(await db.query('select sender_id,sender_role,message from driver_direct_messages order by created_at,id')).rows;
  expect(rows).toHaveLength(2);expect(rows).toEqual(expect.arrayContaining([{sender_id:i.user,sender_role:'driver',message:'Motorista iniciou conversa'},{sender_id:i.operator,sender_role:'operator',message:'Operação respondeu'}]));
  expect(mock.rpc.mock.calls.filter(([name])=>name==='send_driver_chat_message').every(([,args])=>!('sender_role' in args._payload))).toBe(true);
 });
 it('reloads persisted history and refreshes after operation/driver updates',async()=>{
  await chatActor(db);await chatSend(db,await chatPayload(db,i.user,i.driver,'Histórico persistido'));
  const view=render(<Story/>);await selectDriver();await screen.findByText('Histórico persistido');await transport;
  await chatActor(db);await chatSend(db,await chatPayload(db,i.user,i.driver,'Chegou depois'));mock.notify?.();await screen.findByText('Chegou depois');
  view.unmount();client.clear();render(<Story/>);await selectDriver();await screen.findByText('Histórico persistido');await screen.findByText('Chegou depois');
  fireEvent.click(screen.getByRole('button',{name:'Atualizar conversa'}));await waitFor(()=>expect(screen.getAllByRole('article')).toHaveLength(2));
 });
 it('clears selection and drafts across tenant, actor and role switches',async()=>{
  const view=render(<Story/>);await selectDriver();fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Rascunho privado'}});
  mock.tenant=i.otherTenant;view.rerender(<Story/>);await screen.findByText(/Não foi possível carregar os motoristas/);expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
  mock.tenant=i.tenant;view.rerender(<Story/>);await screen.findByRole('option',{name:'Motorista QA'});expect(screen.getByLabelText('Motorista')).toHaveValue('');await selectDriver();expect(screen.getByLabelText('Mensagem')).toHaveValue('');
  mock.actor=i.client;mock.role='client';view.rerender(<Story/>);expect(screen.queryByRole('link',{name:'Chat com motoristas'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
  mock.actor=i.operator;mock.role='operator';view.rerender(<Story/>);await screen.findByRole('option',{name:'Motorista QA'});expect(screen.getByLabelText('Motorista')).toHaveValue('');
 });
 it.each(['client','driver'])('denies the %s operation page and menu before requesting catalog/chat',role=>{
  mock.role=role;render(<Story/>);expect(screen.getByRole('alert')).toHaveTextContent('Sem acesso ao chat operacional');expect(screen.queryByRole('link',{name:'Chat com motoristas'})).not.toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('keeps backend roles and foreign tenant denials authoritative even if frontend role is forged',async()=>{
  mock.actor=i.client;const view=render(<Story/>);await screen.findByText(/Não foi possível carregar os motoristas/);expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();
  mock.actor=i.operator;mock.tenant=i.otherTenant;view.rerender(<Story/>);await screen.findByText(/Não foi possível carregar os motoristas/);
  await transport;await chatActor(db,i.operator);await expect(operationRpc(db,'select get_driver_chat_context($1,$2)',[i.otherTenant,i.foreignDriver])).rejects.toThrow('not_authorized');
  expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(0);
 });
 it('includes inactive history but leaves send permission to existing server context',async()=>{
  await chatActor(db);await chatSend(db,await chatPayload(db,i.user,i.driver,'Antes da inativação'));await db.query('update drivers set active=false where id=$1',[i.driver]);
  render(<Story/>);await screen.findByRole('option',{name:'Motorista QA (inativo)'});fireEvent.change(screen.getByLabelText('Motorista'),{target:{value:i.driver}});
  await screen.findByText('Antes da inativação');await screen.findByText('O motorista não possui um acesso ativo para receber mensagens.');fireEvent.change(screen.getByLabelText('Mensagem'),{target:{value:'Não enviar'}});expect(screen.getByRole('button',{name:'Enviar mensagem'})).toBeDisabled();
 });
 it('hides a selected conversation on catalog failure and does not report an empty success',async()=>{
  render(<Story/>);await selectDriver();mock.catalogError=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar motoristas'}));await screen.findByText(/Não foi possível carregar os motoristas/);
  expect(screen.queryByLabelText('Mensagem')).not.toBeInTheDocument();expect(screen.queryByText('Nenhum motorista disponível nesta empresa.')).not.toBeInTheDocument();
  mock.catalogError=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByRole('option',{name:'Motorista QA'});await screen.findByLabelText('Mensagem');
 });
 it('denies missing tenant or actor and waits for tenant access resolution',()=>{
  mock.loading=true;const view=render(<Story/>);expect(screen.getByRole('status')).toHaveTextContent('Carregando acesso');expect(mock.rpc).not.toHaveBeenCalled();
  mock.loading=false;mock.tenant='';view.rerender(<Story/>);expect(screen.getByRole('alert')).toHaveTextContent('Sem acesso');mock.tenant=i.tenant;mock.actor='';view.rerender(<Story/>);expect(screen.getByRole('alert')).toHaveTextContent('Sem acesso');expect(mock.rpc).not.toHaveBeenCalled();
 });
});
