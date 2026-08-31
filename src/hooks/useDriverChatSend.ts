import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {useTenant} from './useTenant';
import {supabase} from '@/integrations/supabase/client';
import {requestWithDeadline} from '@/lib/requestWithDeadline';
import {chatError,type ChatInput} from '@/lib/driver/chatCommands';
import {CHAT_MESSAGE_CONFIRMED,CHAT_OUTBOX_CHANGED,createChatOutbox,pendingChat} from '@/lib/driver/chatOutbox';
export function useDriverChatSend(){
 const {user}=useAuth(),{currentTenant}=useTenant(),client=useQueryClient(),actor=user?.id,tenant=currentTenant?.id;
 const latest=useRef({tenant,actor});latest.current={tenant,actor};const alive=useRef(true),busy=useRef(false);const [isPending,setPending]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(CHAT_OUTBOX_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(CHAT_OUTBOX_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.tenant!==tenant||latest.current.actor!==actor)throw new Error('A sessão mudou. Recupere a mensagem na sessão original.');},[tenant,actor]);
 const outbox=useMemo(()=>createChatOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(CHAT_OUTBOX_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para enviar mensagens.');return navigator.locks.request(key,work);},
  send:p=>requestWithDeadline(signal=>supabase.rpc(p.event_id?'send_event_chat_message':'send_driver_chat_message',{_payload:JSON.parse(JSON.stringify(p))}).abortSignal(signal)),
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingChat(window.localStorage,tenant,actor):null,error:null};}catch(cause){return {revision,pending:null,error:chatError(cause)};}},[tenant,actor,revision]);
 const run=async(input?:ChatInput)=>{
  if(!tenant||!actor)throw new Error('Entre e selecione a empresa.');if(busy.current)throw new Error('Aguarde o envio em andamento.');assertContext();busy.current=true;setPending(true);
  try{const result=await (input?outbox.submit(tenant,actor,input):outbox.recover(tenant,actor));assertContext();window.dispatchEvent(new CustomEvent(CHAT_MESSAGE_CONFIRMED,{detail:result}));return result;}
  catch(cause){throw new Error(chatError(cause));}finally{busy.current=false;if(alive.current)setPending(false);void client.invalidateQueries({queryKey:['driver-chat',tenant,actor]});}
 };
 return {isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:ChatInput)=>run(input),recover:()=>run()};
}
