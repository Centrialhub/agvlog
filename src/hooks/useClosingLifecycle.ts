import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {closingLifecycleError,parseClosingActionContext,type ClosingActionInput,type ClosingActionResult} from '@/lib/closingReports/closingLifecycle';
import {CLOSING_ACTION_CHANGED,createClosingActionOutbox,pendingClosingAction} from '@/lib/closingReports/closingLifecycleOutbox';
export function useClosingLifecycle(report?:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id;const tenant=currentTenant?.id;
 const latest=useRef({actor,tenant});latest.current={actor,tenant};const alive=useRef(true);const busy=useRef(false);
 const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);const client=useQueryClient();
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(CLOSING_ACTION_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(CLOSING_ACTION_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.actor!==actor||latest.current.tenant!==tenant)throw new Error('A sessão ou empresa mudou. Recupere a transição na sessão original.');},[actor,tenant]);
 const query=useQuery({queryKey:['closing-action-context',tenant,actor,report],enabled:!!tenant&&!!actor&&!!report,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_closing_report_action_context',{_tenant_id:tenant!,_report_id:report!}).abortSignal(signal);
   if(error)throw new Error(closingLifecycleError(error));assertContext();return parseClosingActionContext(data,tenant!,actor!,report!);}});
 const outbox=useMemo(()=>createClosingActionOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(CLOSING_ACTION_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para confirmar a transição.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('apply_closing_report_action',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingClosingAction(window.localStorage,tenant,actor):null,error:null};}
  catch(cause){return {revision,pending:null,error:closingLifecycleError(cause)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<ClosingActionResult>)=>{
  if(!tenant||!actor)throw new Error('Entre com uma sessão válida e selecione a empresa.');if(busy.current)throw new Error('Aguarde a transição em andamento.');
  assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(closingLifecycleError(cause));}
  finally{try{await Promise.all([client.invalidateQueries({queryKey:['closing-reports']}),client.invalidateQueries({queryKey:['closing-report']}),client.invalidateQueries({queryKey:['closing-action-context']})]);}
   finally{busy.current=false;if(alive.current)setPending(false);}}
 };
 return {query,isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:ClosingActionInput)=>run(()=>outbox.submit(tenant!,actor!,input)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
