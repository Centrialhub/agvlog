import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';import {useTenant} from '@/hooks/useTenant';import {supabase} from '@/integrations/supabase/client';
import {closingDraftError,type ClosingDraftInput,type ClosingCreationResult} from '@/lib/closingReports/closingDraft';
import {createClosingDraftOutbox,pendingClosingDraft,CLOSING_DRAFT_CHANGED} from '@/lib/closingReports/closingDraftOutbox';
export function useClosingDraftWrites(){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id;const tenant=currentTenant?.id;const client=useQueryClient();
 const latest=useRef({tenant,actor});latest.current={tenant,actor};const busy=useRef(false);const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);
 const assertContext=useCallback(()=>{if(latest.current.tenant!==tenant||latest.current.actor!==actor)throw new Error('A sessão ou empresa mudou. Recupere o fechamento na sessão original.');},[tenant,actor]);
 useEffect(()=>{const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(CLOSING_DRAFT_CHANGED,changed);
  return()=>{window.removeEventListener('storage',changed);window.removeEventListener(CLOSING_DRAFT_CHANGED,changed);};},[]);
 const outbox=useMemo(()=>createClosingDraftOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(CLOSING_DRAFT_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use um navegador atualizado em conexão segura para criar fechamentos entre abas.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('create_closing_report_draft',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timer);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingClosingDraft(window.localStorage,tenant,actor):null,error:null};}
  catch(error){return {revision,pending:null,error:closingDraftError(error)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<ClosingCreationResult>)=>{
  if(!tenant||!actor)throw new Error('Selecione a empresa e entre com uma sessão válida.');if(busy.current)throw new Error('Aguarde o fechamento em andamento.');
  assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(error){throw new Error(closingDraftError(error));}
  finally{try{await Promise.all([client.invalidateQueries({queryKey:['closing-reports']}),client.invalidateQueries({queryKey:['closing-report']})]);}finally{busy.current=false;setPending(false);}}
 };
 return {isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(payload:ClosingDraftInput)=>run(()=>outbox.submit(tenant!,actor!,payload)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
