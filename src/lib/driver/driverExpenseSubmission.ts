import {isRecord} from '@/lib/loads/operationDocumentOutcome';
import {
 expenseCreationSchema,
 parseCreationResult,
 parseReceiptStatus,
 type ExpenseCreationCommand,
 type ExpenseCreationInput,
 type ExpenseCreationResult,
} from '@/lib/financial/expenseCreationCommands';
import {
 driverExpenseOfflineStore,
 driverExpenseScope,
 restoreExpenseReceipt,
 storeExpenseReceipt,
 type DriverExpenseOfflineDraft,
 type DriverExpenseOfflineStore,
} from './driverExpenseOfflineStore';

export const DRIVER_EXPENSE_QUEUE_CHANGED='agvlog:driver-expense-queue-changed';

export type DriverExpenseSubmissionResult=
 | {queued:false;confirmed:ExpenseCreationResult}
 | {queued:true;requestId:string;needsAttention:boolean;message:string};

export interface DriverExpenseQueueSummary {
 requestId:string;
 sourceId:string;
 category:string;
 amountCents:number;
 createdAt:string;
 state:DriverExpenseOfflineDraft['state'];
 lastError:string|null;
 receiptBytes:number;
}

interface Dependencies {
 store:DriverExpenseOfflineStore;
 uuid:()=>string;
 now:()=>Date;
 online:()=>boolean;
 changed:()=>void;
 lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
 describe:(file:File)=>Promise<ExpenseCreationCommand['receipt']>;
 receiptStatus:(payload:ExpenseCreationCommand)=>Promise<unknown>;
 upload:(payload:ExpenseCreationCommand,file:File)=>Promise<unknown>;
 send:(payload:ExpenseCreationCommand)=>Promise<{data:unknown;error:unknown}>;
}

interface TaggedUploadFailure {driverUploadFailure:true;cause:unknown}
const isTaggedUploadFailure=(value:unknown):value is TaggedUploadFailure=>isRecord(value)&&value.driverUploadFailure===true;

const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??cause.code??''):String(cause??'');
const needsAttention=(cause:unknown)=>{
 const code=isRecord(cause)?String(cause.code??''):'';const message=errorMessage(cause);
 return /context_changed|source_locked|not_authorized|invalid_|key_mismatch|receipt_existing_object_mismatch/.test(message)||/^(22|23)|42501|55000/.test(code);
};

async function updateFailure(deps:Dependencies,draft:DriverExpenseOfflineDraft,cause:unknown){
 const source=isTaggedUploadFailure(cause)?cause.cause:cause;
 const attention=needsAttention(source);await deps.store.save({...draft,state:attention?'needs_attention':'queued',
  uploadFailures:(draft.uploadFailures??0)+(isTaggedUploadFailure(cause)?1:0),lastError:errorMessage(source).slice(0,500)||'Falha de conexão',updatedAt:deps.now().toISOString()});deps.changed();return attention;
}

async function dispatch(deps:Dependencies,draft:DriverExpenseOfflineDraft):Promise<ExpenseCreationResult>{
 const file=restoreExpenseReceipt(draft.receipt);const status=parseReceiptStatus(await deps.receiptStatus(draft.payload),draft.payload);
 if(!status.uploaded){
  try{parseReceiptStatus(await deps.upload(draft.payload,file),draft.payload);}
  catch(cause){throw {driverUploadFailure:true,cause} satisfies TaggedUploadFailure;}
 }
 const {data,error}=await deps.send(draft.payload);if(error)throw error;
 const confirmed=parseCreationResult(data,draft.payload);await deps.store.remove(draft.requestId);deps.changed();return confirmed;
}

export function createDriverExpenseSubmission(deps:Dependencies){
 let inFlight:Promise<DriverExpenseSubmissionResult>|null=null;
 const submit=(tenantId:string,actorId:string,input:ExpenseCreationInput,file:File)=>{
  if(inFlight)return inFlight;
  const work=deps.lock(`agvlog:driver-expense:${driverExpenseScope(tenantId,actorId)}`,async()=>{
   const receipt=await deps.describe(file);const requestId=deps.uuid();const payload=expenseCreationSchema.parse({...input,version:1,tenant_id:tenantId,actor_id:actorId,request_id:requestId,receipt,
    fields:{...input.fields,no_receipt:false,no_receipt_reason:null}});
   const timestamp=deps.now().toISOString();const draft:DriverExpenseOfflineDraft={version:1,requestId,scopeKey:driverExpenseScope(tenantId,actorId),tenantId,actorId,payload,receipt:storeExpenseReceipt(file,payload.receipt!.mime),state:'queued',uploadFailures:0,lastError:null,createdAt:timestamp,updatedAt:timestamp};
   await deps.store.save(draft);deps.changed();
   if(!deps.online())return {queued:true,requestId,needsAttention:false,message:'Despesa e comprovante salvos neste aparelho. A operação receberá quando a conexão voltar.'} as const;
   try{return {queued:false,confirmed:await dispatch(deps,draft)} as const;}catch(cause){const attention=await updateFailure(deps,draft,cause);return {queued:true,requestId,needsAttention:attention,
    message:attention?'A despesa foi preservada, mas precisa de conferência antes da sincronização.':'A despesa foi preservada e será sincronizada quando a conexão estabilizar.'} as const;}
  });
  inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;}).catch(()=>{});return work;
 };
 const replay=async(tenantId:string,actorId:string)=>deps.lock(`agvlog:driver-expense:${driverExpenseScope(tenantId,actorId)}`,async()=>{
  const drafts=await deps.store.list(tenantId,actorId);let confirmed=0,attention=0;
  if(!deps.online())return {confirmed,pending:drafts.length,needsAttention:drafts.filter(row=>row.state==='needs_attention').length};
  for(const draft of drafts){try{await dispatch(deps,draft);confirmed++;}catch(cause){if(await updateFailure(deps,draft,cause))attention++;}}
  return {confirmed,pending:drafts.length-confirmed,needsAttention:attention};
 });
 return {submit,replay,list:async(tenantId:string,actorId:string):Promise<DriverExpenseQueueSummary[]>=>(await deps.store.list(tenantId,actorId)).map(row=>({requestId:row.requestId,sourceId:row.payload.source_id,
  category:row.payload.fields.category,amountCents:row.payload.fields.amount_cents,createdAt:row.createdAt,state:row.state,lastError:row.lastError,receiptBytes:row.receipt.blob.size}))};
}

export {driverExpenseOfflineStore};
