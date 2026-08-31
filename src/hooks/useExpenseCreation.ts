import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {creationError,parseCreationContext,type ExpenseCreationInput,type ExpenseCreationResult} from '@/lib/financial/expenseCreationCommands';
import {EXPENSE_CREATION_CHANGED,createExpenseCreationOutbox,pendingExpenseCreation} from '@/lib/financial/expenseCreationOutbox';
import {uploadExpenseReceipt} from '@/lib/financial/expenseReceiptUpload';
import {expenseRequest} from '@/lib/financial/expenseRequest';
const invalidations=['expense-creation-context','expense-review-context','expense_approval','driver_expenses','ops_expenses_count','driver_settlements','driver_settlement'];
export function useExpenseCreation(type?:'trip'|'settlement',source?:string){
 const {currentTenant}=useTenant(),{user}=useAuth();const tenant=currentTenant?.id,actor=user?.id,client=useQueryClient();
 const latest=useRef({tenant,actor});latest.current={tenant,actor};const alive=useRef(true),busy=useRef(false);const [isPending,setPending]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(EXPENSE_CREATION_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(EXPENSE_CREATION_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.tenant!==tenant||latest.current.actor!==actor)throw new Error('A sessão ou empresa mudou. Recupere a despesa na sessão original.');},[tenant,actor]);
 const query=useQuery({queryKey:['expense-creation-context',tenant,actor,type,source],enabled:!!tenant&&!!actor&&!!type&&!!source,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_expense_creation_context',{_tenant_id:tenant!,_source_type:type!,_source_id:source!}).abortSignal(signal);
   if(error)throw error;assertContext();return parseCreationContext(data,tenant!,actor!,type!,source!);}});
 const outbox=useMemo(()=>createExpenseCreationOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(EXPENSE_CREATION_CHANGED)),
  lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para registrar despesas.');return navigator.locks.request(key,work);},
  upload:uploadExpenseReceipt,
  receiptStatus:async p=>{const {data,error}=await expenseRequest(signal=>supabase.rpc('get_expense_receipt_status',{_tenant_id:p.tenant_id,_request_id:p.request_id,_source_type:p.source_type,_source_id:p.source_id,_receipt:p.receipt!}).abortSignal(signal));if(error)throw error;return data;},
  send:p=>expenseRequest(signal=>supabase.rpc('create_driver_expense_command',{_payload:JSON.parse(JSON.stringify(p))}).abortSignal(signal)),
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingExpenseCreation(window.localStorage,tenant,actor):null,error:null};}catch(cause){return {revision,pending:null,error:creationError(cause)};}},[tenant,actor,revision]);
 const run=async<T,>(work:()=>Promise<T>):Promise<T>=>{
  if(!tenant||!actor)throw new Error('Entre e selecione a empresa.');if(busy.current)throw new Error('Aguarde o pedido em andamento.');assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(creationError(cause));}
  finally{busy.current=false;if(alive.current)setPending(false);void Promise.all(invalidations.map(key=>client.invalidateQueries({queryKey:[key]})));}
 };
 return {query,isPending,pending:recovery.pending,recoveryError:recovery.error,
  submit:(input:ExpenseCreationInput,file?:File):Promise<ExpenseCreationResult>=>run(()=>outbox.submit(tenant!,actor!,input,file)),
  recover:(file?:File)=>run(()=>outbox.recover(tenant!,actor!,file)),abandon:()=>run(()=>outbox.abandon(tenant!,actor!))};
}
