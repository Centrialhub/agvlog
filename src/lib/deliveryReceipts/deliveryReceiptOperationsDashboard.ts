import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {uploadSecureFile} from '@/lib/secureUpload';
import {queueAndSendDeliveryReceiptEmail,type DeliveryReceiptEmailDraft,type DeliveryReceiptRow} from './deliveryReceiptOperations';
import {deliveryReceiptCoverConfigSchema} from './deliveryReceiptSupplier';

const id=z.string().uuid(),timestamp=z.string().datetime({offset:true});
export const deliveryReceiptEmailTemplateSchema=z.object({id,tenant_id:id,supplier_key:z.string().nullable(),supplier_name:z.string(),recipients:z.array(z.string().email()).max(10),
  subject_template:z.string(),body_template:z.string(),cover_config:deliveryReceiptCoverConfigSchema,template_version:z.number().int().positive(),is_active:z.boolean(),created_by:id,updated_by:id,created_at:timestamp,updated_at:timestamp}).strict();
export type DeliveryReceiptEmailTemplate=z.infer<typeof deliveryReceiptEmailTemplateSchema>;
export const deliveryReceiptEmailBatchSchema=z.object({id,supplier_name:z.string(),receipt_ids:z.array(id).max(5),recipients:z.array(z.string()).max(10),
  subject:z.string(),body_text:z.string(),status:z.string(),attempt_count:z.number().int().nonnegative(),last_error:z.string().nullable(),
  retry_after_at:timestamp.nullable(),created_at:timestamp,updated_at:timestamp,sent_at:timestamp.nullable(),delivered_at:timestamp.nullable(),bounced_at:timestamp.nullable()}).strict();
export type DeliveryReceiptEmailBatch=z.infer<typeof deliveryReceiptEmailBatchSchema>;
const deliveryReceiptEmailHistoryItemSchema=z.object({receipt_id:id,file_name:z.string().min(1),documents:z.array(z.object({
  kind:z.string(),number:z.string().nullable().optional(),series:z.string().nullable().optional(),issuer_name:z.string().nullable().optional(),
  issuer_tax_id:z.string().nullable().optional(),
}).passthrough()).max(50)}).strict();
export const deliveryReceiptEmailHistoryBatchSchema=deliveryReceiptEmailBatchSchema.extend({supplier_key:z.string().min(4),
  cover_config:deliveryReceiptCoverConfigSchema,items:z.array(deliveryReceiptEmailHistoryItemSchema).max(5)}).strict();
const deliveryReceiptEmailHistorySchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,
  rows:z.array(deliveryReceiptEmailHistoryBatchSchema).max(100),total:z.number().int().nonnegative(),
  limit:z.number().int().min(1).max(100),offset:z.number().int().nonnegative()}).strict();
export type DeliveryReceiptEmailHistoryBatch=z.infer<typeof deliveryReceiptEmailHistoryBatchSchema>;
const count=z.number().int().nonnegative();
const receiptMetrics=z.object({total:count,pending_validation:count,rejected:count,without_pdf:count,physical_pending:count,replaced:count}).strict();
const emailMetrics=z.object({queued:count,sending:count,sent:count,delivered:count,bounced:count,failed:count,retryable:count}).strict();
const expenseMetrics=z.object({pending:count,approved:count,rejected:count,without_receipt:count}).strict();
const operationsSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,generated_at:timestamp,receipts:receiptMetrics,emails:emailMetrics,
  expenses:expenseMetrics,templates:z.array(deliveryReceiptEmailTemplateSchema),batches:z.array(deliveryReceiptEmailBatchSchema).max(50)}).strict();
export type DeliveryReceiptOperations=z.infer<typeof operationsSchema>;
const ocrHealthSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,queued:count,processing:count,completed:count,
  failed:count,unavailable:count,low_confidence:count}).strict();
const ocrSearchSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,rows:z.array(z.object({receipt_id:id,
  status:z.literal('completed'),confidence:z.number().min(0).max(1).nullable(),text:z.string().max(1000),processed_hash:z.string().length(64),
  updated_at:timestamp})).max(100)}).strict();
export type DeliveryReceiptOcrHealth=z.infer<typeof ocrHealthSchema>;
export type DeliveryReceiptOcrMatch=z.infer<typeof ocrSearchSchema>['rows'][number];

interface RpcResponse{data:unknown;error:unknown}
interface RpcBuilder extends PromiseLike<RpcResponse>{abortSignal:(signal:AbortSignal)=>PromiseLike<RpcResponse>}
const rpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>RpcBuilder;

export async function getDeliveryReceiptOperations(tenant:string,actor:string,signal?:AbortSignal){
  const request=rpc('get_delivery_receipt_operations_v1',{_tenant_id:tenant});const {data,error}=await(signal?request.abortSignal(signal):request);
  if(error)throw error;const parsed=operationsSchema.parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor)throw new Error('Painel operacional incompatível com a sessão atual.');return parsed;
}

export async function listDeliveryReceiptEmailHistory(tenant:string,actor:string,input:{search?:string;status?:string;limit?:number;offset?:number}={},signal?:AbortSignal){
  const limit=input.limit??25,offset=input.offset??0;const request=rpc('list_delivery_receipt_email_batches_v1',{
    _tenant_id:tenant,_search:input.search?.trim()||null,_status:input.status||null,_limit:limit,_offset:offset});
  const {data,error}=await(signal?request.abortSignal(signal):request);if(error)throw error;
  const parsed=deliveryReceiptEmailHistorySchema.parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.limit!==limit||parsed.offset!==offset){
    throw new Error('Histórico de e-mails incompatível com a sessão atual.');
  }
  return parsed;
}

export async function getDeliveryReceiptOcrHealth(tenant:string,actor:string,signal?:AbortSignal){
  const request=rpc('get_delivery_receipt_ocr_health_v1',{_tenant_id:tenant});const {data,error}=await(signal?request.abortSignal(signal):request);
  if(error)throw error;const parsed=ocrHealthSchema.parse(data);if(parsed.tenant_id!==tenant||parsed.actor_id!==actor)throw new Error('OCR incompatível com a sessão atual.');
  return parsed;
}

export async function searchDeliveryReceiptOcr(tenant:string,actor:string,query:string,signal?:AbortSignal){
  const request=rpc('search_delivery_receipt_ocr_v1',{_tenant_id:tenant,_query:query.trim(),_limit:50});const {data,error}=await(signal?request.abortSignal(signal):request);
  if(error)throw error;const parsed=ocrSearchSchema.parse(data);if(parsed.tenant_id!==tenant||parsed.actor_id!==actor)throw new Error('Busca OCR incompatível com a sessão atual.');
  return parsed.rows;
}

export async function saveDeliveryReceiptEmailTemplate(tenant:string,actor:string,input:{id?:string;supplier:string;recipients:string[];
  supplierKey:string;subject:string;body:string;cover:DeliveryReceiptEmailDraft['cover'];active?:boolean;expectedUpdatedAt?:string|null}){
  const templateId=input.id??crypto.randomUUID();const {data,error}=await rpc('save_delivery_receipt_email_template_v2',{
    _tenant_id:tenant,_template_id:templateId,_supplier_key:input.supplierKey,_supplier_name:input.supplier,_recipients:input.recipients,
    _subject:input.subject,_body:input.body,_cover_config:input.cover,_is_active:input.active??true,_expected_updated_at:input.expectedUpdatedAt??null});
  if(error)throw error;const parsed=z.object({version:z.literal(1),tenant_id:id,actor_id:id,template:deliveryReceiptEmailTemplateSchema,
    confirmed:z.literal(true),replayed:z.boolean().optional()}).strict().parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.template.id!==templateId)throw new Error('Modelo não confirmado para esta sessão.');
  return parsed.template;
}

const replacementSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,previous_receipt_id:id,
  replacement_receipt_id:id,digital_status:z.literal('pending_validation'),updated_at:timestamp,confirmed:z.literal(true)}).strict();
export async function replaceDeliveryReceipt(tenant:string,actor:string,row:DeliveryReceiptRow,file:File,reason:string){
  const requestId=crypto.randomUUID();const path=await uploadSecureFile({tenantId:tenant,bucket:'receipts',
    folder:`delivery-replacements/${row.id}/${requestId}`,file,kind:'proof'});
  const {data,error}=await rpc('replace_delivery_receipt_v1',{_tenant_id:tenant,_receipt_id:row.id,_request_id:requestId,
    _path:path,_reason:reason.trim(),_expected_updated_at:row.updated_at});
  if(error)throw error;const parsed=replacementSchema.parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.request_id!==requestId||parsed.previous_receipt_id!==row.id){
    throw new Error('Substituição não confirmada para esta sessão.');
  }
  return parsed;
}

const batchSendResult=z.object({batch_id:id,status:z.literal('sent'),provider_message_id:z.string().min(5),replayed:z.boolean()}).strict();
export async function retryDeliveryReceiptEmailBatch(tenant:string,batchId:string){
  const invocation=await supabase.functions.invoke('send-delivery-receipts',{body:{tenant_id:tenant,batch_id:batchId}});
  if(invocation.error)throw invocation.error;const result=batchSendResult.parse(invocation.data);
  if(result.batch_id!==batchId)throw new Error('Reenvio não confirmado para o lote solicitado.');return result;
}

const bulkDraftSchema=z.object({supplierKey:z.string().trim().min(4).max(200),supplier:z.string().trim().min(2).max(200),receiptIds:z.array(id).min(1),
  recipients:z.array(z.string().trim().toLowerCase().email()).min(1).max(10),subject:z.string().trim().min(3).max(200),body:z.string().trim().min(3).max(5000),
  cover:deliveryReceiptCoverConfigSchema}).strict()
  .refine(value=>new Set(value.receiptIds).size===value.receiptIds.length&&new Set(value.recipients).size===value.recipients.length);
const sizePlanItemSchema=z.object({receipt_id:id,source_bytes:z.number().int().positive(),cover_reserve_bytes:z.number().int().nonnegative(),
  projected_bytes:z.number().int().positive()}).strict();
const sizePlanSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,supplier_key:z.string(),receipt_count:z.number().int().positive(),
  source_bytes:z.number().int().positive(),cover_reserve_bytes_per_file:z.number().int().nonnegative(),max_attachments_per_batch:z.literal(5),
  max_attachment_bytes:z.literal(5*1024*1024),max_batch_bytes:z.literal(25*1024*1024),batches:z.array(z.object({items:z.array(sizePlanItemSchema).min(1).max(5),
    source_bytes:z.number().int().positive(),projected_bytes:z.number().int().positive().max(25*1024*1024)}).strict()).min(1)}).strict();
const manifestSchema=z.object({draft:bulkDraftSchema,createdAt:timestamp,chunks:z.array(z.object({requestId:id,receiptIds:z.array(id).min(1).max(5),
  sourceBytes:z.number().int().positive(),projectedBytes:z.number().int().positive().max(25*1024*1024),result:batchSendResult.nullable()}))}).strict();
type Manifest=z.infer<typeof manifestSchema>;
const manifestKey=(tenant:string,actor:string)=>`agvlog:delivery-receipt-email-bulk:v2:${tenant}:${actor}`;
function manifests(tenant:string,actor:string){try{const value=JSON.parse(localStorage.getItem(manifestKey(tenant,actor))??'[]');
  return Array.isArray(value)?value.flatMap(item=>{const parsed=manifestSchema.safeParse(item);return parsed.success?[parsed.data]:[];}):[];}catch{return [];}}
function saveManifests(tenant:string,actor:string,value:Manifest[]){try{localStorage.setItem(manifestKey(tenant,actor),JSON.stringify(value.slice(-10)));}
  catch{throw new Error('delivery_email_outbox_unavailable');}}

export async function queueAndSendDeliveryReceiptEmailBatches(tenant:string,actor:string,draft:DeliveryReceiptEmailDraft){
  const canonical=bulkDraftSchema.parse({...draft,supplier:draft.supplier.trim(),receiptIds:[...draft.receiptIds].sort(),
    recipients:[...draft.recipients].map(value=>value.trim().toLowerCase()).sort(),subject:draft.subject.trim(),body:draft.body.trim()});
  const serialized=JSON.stringify(canonical),stored=manifests(tenant,actor);let manifest=stored.find(value=>JSON.stringify(value.draft)===serialized);
  if(manifest&&Date.now()-Date.parse(manifest.createdAt)>24*60*60*1000)throw new Error('delivery_email_outbox_expired');
  if(!manifest){const chunks:Manifest['chunks']=[];
    for(let offset=0;offset<canonical.receiptIds.length;offset+=100){const receiptIds=canonical.receiptIds.slice(offset,offset+100);
      const planned=await rpc('plan_delivery_receipt_email_batches_v1',{_tenant_id:tenant,_supplier_key:canonical.supplierKey,
        _supplier_name:canonical.supplier,_receipt_ids:receiptIds,_cover_config:canonical.cover});if(planned.error)throw planned.error;
      const plan=sizePlanSchema.parse(planned.data);if(plan.tenant_id!==tenant||plan.actor_id!==actor||plan.supplier_key!==canonical.supplierKey
        ||plan.receipt_count!==receiptIds.length)throw new Error('delivery_email_size_plan_invalid');
      const plannedIds=plan.batches.flatMap(batch=>batch.items.map(item=>item.receipt_id));
      if(JSON.stringify([...plannedIds].sort())!==JSON.stringify(receiptIds))throw new Error('delivery_email_size_plan_invalid');
      chunks.push(...plan.batches.map(batch=>({requestId:crypto.randomUUID(),receiptIds:batch.items.map(item=>item.receipt_id),
        sourceBytes:batch.source_bytes,projectedBytes:batch.projected_bytes,result:null})));
    }
    manifest={draft:canonical,createdAt:new Date().toISOString(),chunks};
    saveManifests(tenant,actor,[...stored,manifest]);}
  for(const chunk of manifest.chunks){if(chunk.result)continue;chunk.result=await queueAndSendDeliveryReceiptEmail(tenant,actor,
    {...canonical,receiptIds:chunk.receiptIds},{requestId:chunk.requestId});saveManifests(tenant,actor,stored.filter(value=>value!==manifest).concat(manifest));}
  return {batchCount:manifest.chunks.length,receiptCount:canonical.receiptIds.length,results:manifest.chunks.map(chunk=>chunk.result!)};
}
