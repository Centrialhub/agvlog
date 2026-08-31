import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';
import {invalidateCompositionQueries} from '@/lib/loads/compositionMutation';
import {isRedeliveryContext,redeliveryMessage,type RedeliveryExpected,type RedeliveryPayload,type RedeliveryResult} from '@/lib/loads/redelivery';
import {createRedeliveryOutbox,pendingRedeliveries,REDELIVERY_CHANGED} from '@/lib/loads/redeliveryOutbox';
export function useRedeliveryContext(doc:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const tenant=currentTenant?.id;const actor=user?.id;
 return useQuery({queryKey:['redelivery_context',tenant,actor,doc],enabled:!!tenant&&!!actor&&!!doc,queryFn:async({signal})=>{
  const {data,error}=await supabase.rpc('get_redelivery_context',{_tenant_id:tenant!,_document_id:doc}).abortSignal(signal);
  if(error)throw new Error(redeliveryMessage(error));
  if(!isRedeliveryContext(data)||data.tenant_id!==tenant||data.actor_id!==actor||data.document_id!==doc)throw new Error('Contexto da reentrega não confirmado.');
  return data;
 }});
}
export function useRedelivery(){
 const {user}=useAuth();const {currentTenant}=useTenant();const tenant=currentTenant?.id;const actor=user?.id;const client=useQueryClient();
 const current=useRef({tenant,actor});current.current={tenant,actor};const busy=useRef(false);const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);
 useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('storage',refresh);window.addEventListener(REDELIVERY_CHANGED,refresh);
  return()=>{window.removeEventListener('storage',refresh);window.removeEventListener(REDELIVERY_CHANGED,refresh);};},[]);
 const assertContext=useCallback(()=>{if(current.current.tenant!==tenant||current.current.actor!==actor)throw new Error('A sessão ou empresa mudou. Recupere a reentrega na empresa original.');},[tenant,actor]);
 const outbox=useMemo(()=>createRedeliveryOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(REDELIVERY_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para recuperar reentregas entre abas.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('request_document_redelivery',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timer);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {items:tenant&&actor?pendingRedeliveries(window.localStorage,tenant,actor):[],error:null};}
  catch(error){return {items:[],error:redeliveryMessage(error)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<RedeliveryResult>)=>{
  if(!tenant||!actor)throw new Error('Selecione a empresa e entre com uma sessão válida.');if(busy.current)throw new Error('Aguarde a reentrega em andamento.');
  assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(error){throw new Error(redeliveryMessage(error));}
  finally{try{await invalidateCompositionQueries(client);}finally{busy.current=false;setPending(false);}}
 };
 return {isPending,pending:recovery.items,recoveryError:recovery.error,
  submit:(payload:Omit<RedeliveryPayload,'tenant_id'>,expected:RedeliveryExpected)=>run(()=>outbox.submit(tenant!,actor!,{...payload,tenant_id:tenant!},expected)),
  recover:(doc:string)=>run(()=>outbox.recover(tenant!,actor!,doc))};
}
