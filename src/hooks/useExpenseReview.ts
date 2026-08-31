import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {expenseReviewError,parseExpenseReviewContext,parseExpenseReviewList,type ExpenseReviewInput,type ExpenseReviewResult} from '@/lib/financial/expenseReviewCommands';
import {EXPENSE_REVIEW_CHANGED,createExpenseReviewOutbox,pendingExpenseReview} from '@/lib/financial/expenseReviewOutbox';
const invalidations=['expense-review-context','expense_approval','driver_expenses','ops_expenses_count','driver_settlements','driver_settlement','financial_obligations','financial_matches_suggested'];
export function useExpenseReviewList(filter:'pending'|'reviewed',offset:number){
 const {currentTenant}=useTenant();const {user}=useAuth();const tenant=currentTenant?.id,actor=user?.id;const client=useQueryClient();
 useEffect(()=>{if(!tenant||!actor)return;const channel=supabase.channel('expense-reviews:'+tenant+':'+actor).on('postgres_changes',{event:'*',schema:'public',table:'driver_expenses',filter:'tenant_id=eq.'+tenant},()=>{
  for(const key of invalidations)void client.invalidateQueries({queryKey:[key]});
 }).subscribe();return()=>{void supabase.removeChannel(channel);};},[tenant,actor,client]);
 return useQuery({queryKey:['expense_approval',tenant,actor,filter,offset],enabled:!!tenant&&!!actor,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('list_driver_expenses_for_review',{_tenant_id:tenant!,_status:filter,_offset:offset}).abortSignal(signal);
   if(error)throw new Error(expenseReviewError(error));return parseExpenseReviewList(data,tenant!,actor!,filter,offset);}});
}
export function useExpenseReview(expense?:string){
 const {user}=useAuth();const {currentTenant}=useTenant();const actor=user?.id,tenant=currentTenant?.id;const client=useQueryClient();
 const latest=useRef({actor,tenant});latest.current={actor,tenant};const alive=useRef(true),busy=useRef(false);const [isPending,setPending]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{alive.current=true;const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(EXPENSE_REVIEW_CHANGED,changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener(EXPENSE_REVIEW_CHANGED,changed);};},[]);
 const assertContext=useCallback(()=>{if(!alive.current||latest.current.actor!==actor||latest.current.tenant!==tenant)throw new Error('A sessão ou empresa mudou. Recupere a revisão na sessão original.');},[actor,tenant]);
 const query=useQuery({queryKey:['expense-review-context',tenant,actor,expense],enabled:!!tenant&&!!actor&&!!expense,retry:false,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('get_driver_expense_review_context',{_tenant_id:tenant!,_expense_id:expense!}).abortSignal(signal);
   if(error)throw new Error(expenseReviewError(error));assertContext();return parseExpenseReviewContext(data,tenant!,actor!,expense!);}});
 const outbox=useMemo(()=>createExpenseReviewOutbox({get storage(){return window.localStorage;},uuid:()=>crypto.randomUUID(),assertContext,
  changed:()=>window.dispatchEvent(new Event(EXPENSE_REVIEW_CHANGED)),lock:async(key,work)=>{if(!navigator.locks)throw new Error('Use navegador atualizado em conexão segura para revisar despesas.');return navigator.locks.request(key,work);},
  send:async payload=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{return await supabase.rpc('review_driver_expense',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}}
 }),[assertContext]);
 const recovery=useMemo(()=>{try{return {revision,pending:tenant&&actor?pendingExpenseReview(window.localStorage,tenant,actor):null,error:null};}
  catch(cause){return {revision,pending:null,error:expenseReviewError(cause)};}},[tenant,actor,revision]);
 const run=async(work:()=>Promise<ExpenseReviewResult>)=>{
  if(!tenant||!actor)throw new Error('Entre e selecione a empresa.');if(busy.current)throw new Error('Aguarde a revisão em andamento.');assertContext();busy.current=true;setPending(true);
  try{const result=await work();assertContext();return result;}catch(cause){throw new Error(expenseReviewError(cause));}
  finally{try{await Promise.all(invalidations.map(key=>client.invalidateQueries({queryKey:[key]})));}finally{busy.current=false;if(alive.current)setPending(false);}}
 };
 return {query,isPending,pending:recovery.pending,recoveryError:recovery.error,submit:(input:ExpenseReviewInput)=>run(()=>outbox.submit(tenant!,actor!,input)),recover:()=>run(()=>outbox.recover(tenant!,actor!))};
}
