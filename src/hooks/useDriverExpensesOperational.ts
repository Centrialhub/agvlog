import {useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {supabase} from '@/integrations/supabase/client';
import {parseCreationContext,type ExpenseCreationInput,type ExpenseCreationContext} from '@/lib/financial/expenseCreationCommands';
import {expenseRequest} from '@/lib/financial/expenseRequest';
import {describeExpenseReceipt,uploadExpenseReceipt} from '@/lib/financial/expenseReceiptUpload';
import {
 DRIVER_EXPENSE_QUEUE_CHANGED,
 createDriverExpenseSubmission,
 driverExpenseOfflineStore,
 type DriverExpenseSubmissionResult,
} from '@/lib/driver/driverExpenseSubmission';
import type {DriverExpenseSource} from '@/lib/driver/driverExpenseOfflineStore';

const id=z.string().uuid();
const sourceSchema=z.object({id,driver_id:id,status:z.enum(['planned','in_transit','completed']),notes:z.string().nullable(),created_at:z.string(),actual_start_at:z.string().nullable(),actual_end_at:z.string().nullable()}).strict();
const sourcesSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,offset:z.number().int().nonnegative(),total:z.number().int().nonnegative(),rows:z.array(sourceSchema).max(50)}).strict();

const submission=createDriverExpenseSubmission({
 store:driverExpenseOfflineStore,uuid:()=>crypto.randomUUID(),now:()=>new Date(),online:()=>navigator.onLine,
 changed:()=>window.dispatchEvent(new Event(DRIVER_EXPENSE_QUEUE_CHANGED)),lock:async(key,work)=>navigator.locks?navigator.locks.request(key,work):work(),
 describe:describeExpenseReceipt,upload:uploadExpenseReceipt,
 receiptStatus:async payload=>{const {data,error}=await expenseRequest(signal=>supabase.rpc('get_expense_receipt_status',{_tenant_id:payload.tenant_id,_request_id:payload.request_id,_source_type:'trip',_source_id:payload.source_id,_receipt:payload.receipt!}).abortSignal(signal));if(error)throw error;return data;},
 send:payload=>expenseRequest(signal=>supabase.rpc('create_driver_expense_command',{_payload:JSON.parse(JSON.stringify(payload))}).abortSignal(signal)),
});

function useScope(){const {user}=useAuth(),{currentTenant}=useTenant();return {tenantId:currentTenant?.id,actorId:user?.id};}

export function useOperationalDriverExpenseSources(offset:number,enabled=true){
 const {tenantId,actorId}=useScope();
 return useQuery({queryKey:['driver-expense-operational-sources',tenantId,actorId,offset],enabled:enabled&&!!tenantId&&!!actorId,retry:false,networkMode:'always',queryFn:async({signal})=>{
  try{const {data,error}=await supabase.rpc('list_driver_expense_sources',{_tenant_id:tenantId!,_offset:offset}).abortSignal(signal);if(error)throw error;const page=sourcesSchema.parse(data);
   if(page.tenant_id!==tenantId||page.actor_id!==actorId||page.offset!==offset)throw new Error('Viagens incompatíveis com esta sessão.');if(offset===0)void driverExpenseOfflineStore.saveSources(tenantId!,actorId!,page.rows).catch(()=>{});return {...page,offline:false};
  }catch(cause){const cached=offset===0?await driverExpenseOfflineStore.readSources(tenantId!,actorId!):[];if(!cached.length)throw cause;return {version:1 as const,tenant_id:tenantId!,actor_id:actorId!,offset,total:cached.length,rows:cached,offline:true};}
 }});
}

export function useOperationalDriverExpenseContext(sourceId:string|undefined){
 const {tenantId,actorId}=useScope();
 return useQuery({queryKey:['driver-expense-operational-context',tenantId,actorId,sourceId],enabled:!!tenantId&&!!actorId&&!!sourceId,retry:false,networkMode:'always',queryFn:async({signal})=>{
  try{const {data,error}=await supabase.rpc('get_expense_creation_context',{_tenant_id:tenantId!,_source_type:'trip',_source_id:sourceId!}).abortSignal(signal);if(error)throw error;
   const context=parseCreationContext(data,tenantId!,actorId!,'trip',sourceId!);void driverExpenseOfflineStore.saveContext(tenantId!,actorId!,context).catch(()=>{});return {context,offline:false};
  }catch(cause){const context=await driverExpenseOfflineStore.readContext(tenantId!,actorId!,sourceId!);if(!context)throw cause;return {context,offline:true};}
 }});
}

export function useDriverExpenseSubmission(){
 const {tenantId,actorId}=useScope(),client=useQueryClient(),latest=useRef({tenantId,actorId});latest.current={tenantId,actorId};
 const queueKey=['driver-expense-operational-queue',tenantId,actorId] as const;
 const pending=useQuery({queryKey:queueKey,enabled:!!tenantId&&!!actorId,networkMode:'always',queryFn:()=>submission.list(tenantId!,actorId!)});
 const invalidate=async()=>{await Promise.all([client.invalidateQueries({queryKey:queueKey}),client.invalidateQueries({queryKey:['driver_expenses']}),client.invalidateQueries({queryKey:['expense_approval']})]);};
 const submit=useMutation({mutationFn:async({input,file}:{input:ExpenseCreationInput;file:File}):Promise<DriverExpenseSubmissionResult>=>{
  if(!tenantId||!actorId)throw new Error('Entre e selecione a empresa.');const scope={tenantId,actorId};const result=await submission.submit(tenantId,actorId,input,file);
  if(latest.current.tenantId!==scope.tenantId||latest.current.actorId!==scope.actorId)throw new Error('A sessão mudou. Consulte a fila da sessão original.');return result;
 },onSettled:()=>void invalidate()});
 const replay=useMutation({mutationFn:async()=>{if(!tenantId||!actorId)throw new Error('Entre e selecione a empresa.');return submission.replay(tenantId,actorId);},onSettled:()=>void invalidate()});
 return {pending,submit,replay};
}

export type {DriverExpenseSource,ExpenseCreationContext};
