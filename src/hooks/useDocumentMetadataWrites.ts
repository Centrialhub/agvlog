import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';
import {invalidateCompositionQueries} from '@/lib/loads/compositionMutation';
import {metadataError,type MetadataPayload,type MetadataResult} from '@/lib/loads/documentMetadata';
import {createMetadataOutbox,pendingMetadata,METADATA_CHANGED} from '@/lib/loads/documentMetadataOutbox';
export function useDocumentMetadataWrites(){
 const {user}=useAuth();const {currentTenant}=useTenant();const tenant=currentTenant?.id;const actor=user?.id;const client=useQueryClient();
 const latest=useRef({tenant,actor});latest.current={tenant,actor};const busy=useRef(false);const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);
 useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('storage',refresh);window.addEventListener(METADATA_CHANGED,refresh);
  return()=>{window.removeEventListener('storage',refresh);window.removeEventListener(METADATA_CHANGED,refresh);};},[]);
 const assertContext=useCallback(()=>{if(latest.current.tenant!==tenant||latest.current.actor!==actor)throw new Error('A sessão ou empresa mudou. Recupere a conferência na sessão original.');},[tenant,actor]);
 const outbox=useMemo(()=>createMetadataOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(METADATA_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use um navegador atualizado em conexão segura para conferir notas entre abas.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('update_load_document_metadata',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timer);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,items:tenant&&actor?pendingMetadata(window.localStorage,tenant,actor):[],error:null};}
  catch(error){return {revision,items:[],error:metadataError(error)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<MetadataResult>)=>{
  if(!tenant||!actor)throw new Error('Selecione a empresa e entre com uma sessão válida.');if(busy.current)throw new Error('Aguarde a conferência em andamento.');
  assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(error){throw new Error(metadataError(error));}
  finally{try{await invalidateCompositionQueries(client);}finally{busy.current=false;setPending(false);}}
 };
 return {isPending,pending:recovery.items,recoveryError:recovery.error,
  submit:(payload:Omit<MetadataPayload,'tenant_id'>)=>run(()=>outbox.submit(tenant!,actor!,{...payload,tenant_id:tenant!})),
  recover:(load:string)=>run(()=>outbox.recover(tenant!,actor!,load))};
}
