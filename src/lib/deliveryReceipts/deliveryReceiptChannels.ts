import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';

const id=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const documentKind=z.enum(['nfe','nfse','cte','other_fiscal','operational_reference']);
export const supplierPortalCapabilitiesSchema=z.object({
  receipt_upload:z.boolean(),document_metadata:z.boolean(),supports_idempotency:z.boolean(),multi_receipt_batch:z.boolean(),
  max_files_per_request:z.number().int().min(1).max(5),accepted_document_kinds:z.array(documentKind).min(1).max(5)
    .refine(values=>new Set(values).size===values.length),
}).strict();
export type SupplierPortalCapabilities=z.infer<typeof supplierPortalCapabilitiesSchema>;
export const defaultSupplierPortalCapabilities:SupplierPortalCapabilities={receipt_upload:true,document_metadata:true,
  supports_idempotency:true,multi_receipt_batch:false,max_files_per_request:1,
  accepted_document_kinds:['nfe','nfse','cte','other_fiscal','operational_reference']};

export const supplierPortalConfigurationSchema=z.object({
  portal_origin:z.string().url().refine(value=>value.startsWith('https://')),
  account_reference:z.string().trim().min(1).max(120).nullable(),
  credential_reference:z.string().regex(/^[A-Z][A-Z0-9_]{5,119}$/),
  upload_path_hint:z.string().trim().min(1).max(240).nullable(),
}).strict();
export type SupplierPortalConfiguration=z.infer<typeof supplierPortalConfigurationSchema>;

const adapterSchema=z.object({adapter_key:z.string(),channel_kind:z.enum(['email','portal']),display_name:z.string(),
  is_implemented:z.boolean(),is_enabled:z.boolean(),supported_capabilities:z.record(z.string(),z.unknown())}).strict();
const channelSchema=z.object({id,tenant_id:id,supplier_key:z.string(),supplier_name:z.string(),channel_kind:z.literal('portal'),adapter_key:z.string(),
  lifecycle_status:z.enum(['draft','verified','suspended']),safe_configuration:supplierPortalConfigurationSchema,
  requested_capabilities:supplierPortalCapabilitiesSchema,verified_capabilities:supplierPortalCapabilitiesSchema.nullable(),
  auto_enqueue_requested:z.boolean(),auto_enqueue:z.boolean(),verification_reference:z.string().nullable(),verified_at:timestamp.nullable(),
  verified_by:z.string().nullable(),created_by:id,updated_by:id,created_at:timestamp,updated_at:timestamp}).strict();
export type DeliveryReceiptSupplierChannel=z.infer<typeof channelSchema>;
const jobSchema=z.object({id,channel_id:id,receipt_id:id,supplier_key:z.string(),adapter_key:z.string(),
  status:z.enum(['queued','processing','succeeded','failed','unavailable','cancelled']),attempt_count:z.number().int().nonnegative(),
  retry_after_at:timestamp.nullable(),external_reference:z.string().nullable(),last_error_code:z.string().nullable(),
  created_at:timestamp,updated_at:timestamp,completed_at:timestamp.nullable()}).strict();
export type DeliveryReceiptChannelJob=z.infer<typeof jobSchema>;
const count=z.number().int().nonnegative();
const responseSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,generated_at:timestamp,
  adapters:z.array(adapterSchema),channels:z.array(channelSchema),jobs:z.array(jobSchema).max(100),
  metrics:z.object({queued:count,processing:count,succeeded:count,failed:count,unavailable:count,cancelled:count}).strict()}).strict();
export type DeliveryReceiptChannelOperations=z.infer<typeof responseSchema>;

interface RpcResponse{data:unknown;error:unknown}
interface RpcBuilder extends PromiseLike<RpcResponse>{abortSignal:(signal:AbortSignal)=>PromiseLike<RpcResponse>}
const rpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>RpcBuilder;

export async function getDeliveryReceiptSupplierChannels(tenant:string,actor:string,signal?:AbortSignal){
  const request=rpc('get_delivery_receipt_supplier_channels_v1',{_tenant_id:tenant});
  const {data,error}=await(signal?request.abortSignal(signal):request);if(error)throw error;
  const parsed=responseSchema.parse(data);if(parsed.tenant_id!==tenant||parsed.actor_id!==actor){
    throw new Error('Canais de canhoto incompatíveis com a sessão atual.');
  }
  return parsed;
}

export async function saveDeliveryReceiptSupplierChannel(tenant:string,actor:string,input:{id?:string;supplierKey:string;supplierName:string;
  configuration:SupplierPortalConfiguration;capabilities?:SupplierPortalCapabilities;autoEnqueueRequested?:boolean;expectedUpdatedAt?:string|null}){
  const channelId=input.id??crypto.randomUUID(),configuration=supplierPortalConfigurationSchema.parse(input.configuration);
  const capabilities=supplierPortalCapabilitiesSchema.parse(input.capabilities??defaultSupplierPortalCapabilities);
  const {data,error}=await rpc('save_delivery_receipt_supplier_channel_v1',{_tenant_id:tenant,_channel_id:channelId,
    _supplier_key:input.supplierKey,_supplier_name:input.supplierName,_adapter_key:'supplier_portal_generic_v1',
    _safe_configuration:configuration,_requested_capabilities:capabilities,_auto_enqueue_requested:input.autoEnqueueRequested??true,
    _expected_updated_at:input.expectedUpdatedAt??null});
  if(error)throw error;
  const parsed=z.object({version:z.literal(1),tenant_id:id,actor_id:id,channel:channelSchema,confirmed:z.literal(true),replayed:z.boolean()}).strict().parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.channel.id!==channelId)throw new Error('Canal de fornecedor não confirmado para esta sessão.');
  return parsed.channel;
}

export async function retryDeliveryReceiptChannelJob(tenant:string,actor:string,jobId:string){
  const {data,error}=await rpc('retry_delivery_receipt_channel_job_v1',{_tenant_id:tenant,_job_id:jobId});if(error)throw error;
  const parsed=z.object({version:z.literal(1),tenant_id:id,actor_id:id,job_id:id,status:z.literal('queued'),confirmed:z.literal(true)}).strict().parse(data);
  if(parsed.tenant_id!==tenant||parsed.actor_id!==actor||parsed.job_id!==jobId)throw new Error('Reenvio ao portal não confirmado para esta sessão.');
  return parsed;
}
