import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {financialError,parseFinancialContext,type FinancialCommandInput,type FinancialResult} from '@/lib/financial/receivableCommands';
import {FINANCIAL_COMMAND_CHANGED,createFinancialOutbox,pendingFinancialCommand} from '@/lib/financial/receivableFinancialOutbox';
export function useReceivableFinancial(receivable?:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id;const tenant=currentTenant?.id;
 const latest=useRef({actor,tenant});latest.current={actor,tenant};const alive=useRef(true);const busy=useRef(false);
 const [isPending,setPending]=useState(false);const [revision,setRevision]=useState(0);const client=useQueryClient();
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(FINANCIAL_COMMAND_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(FINANCIAL_COMMAND_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.actor!==actor||latest.current.tenant!==tenant)throw new Error('A sessão ou empresa mudou. Recupere a operação financeira na sessão original.');},[actor,tenant]);
 const query=useQuery({queryKey:['receivable-financial-context',tenant,actor,receivable],enabled:!!tenant&&!!actor&&!!receivable,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_receivable_financial_context',{_tenant_id:tenant!,_receivable_id:receivable!}).abortSignal(signal);
   if(error)throw new Error(financialError(error));assertContext();return parseFinancialContext(data,tenant!,actor!,receivable!);}});
 const outbox=useMemo(()=>createFinancialOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(FINANCIAL_COMMAND_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para confirmar a operação financeira.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('apply_receivable_financial_command',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingFinancialCommand(window.localStorage,tenant,actor):null,error:null};}
  catch(cause){return {revision,pending:null,error:financialError(cause)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<FinancialResult>)=>{
  if(!tenant||!actor)throw new Error('Entre com uma sessão válida e selecione a empresa.');if(busy.current)throw new Error('Aguarde a operação financeira em andamento.');
  assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(financialError(cause));}
  finally{try{await Promise.all(['receivable-financial-context','receivables','receivables_payments','client_invoices','client_invoice_detail','client-invoice-context','closing-reports','closing-report','closing-action-context','bank_transactions','bank_accounts','financial_obligations','financial_matches_suggested'].map(key=>client.invalidateQueries({queryKey:[key]})))}
   finally{busy.current=false;if(alive.current)setPending(false);}}
 };
 return {query,isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:FinancialCommandInput)=>run(()=>outbox.submit(tenant!,actor!,input)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
