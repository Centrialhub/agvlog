import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';

const id=z.string().uuid();
const revision=z.string().regex(/^[a-f0-9]{64}$/);
const timestamp=z.string().datetime({offset:true}).nullable();

export const operationalEventBindingsSchema=z.object({
 load_id:id.optional(),order_id:id.optional(),vehicle_id:id.optional(),driver_id:id.optional(),client_id:id.optional(),
 dispatch_trip_id:id.optional(),dispatch_stop_id:id.optional(),fiscal_document_id:id.optional(),proof_of_delivery_id:id.optional(),
}).strict();
export type OperationalEventBindings=z.infer<typeof operationalEventBindingsSchema>;

export const operationalEventCreateCommandSchema=z.object({
 version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,expected_revision:revision,
 event_type:z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),severity:z.enum(['low','medium','high','critical']),
 description:z.string().trim().min(5).max(4000),financial_impact_cents:z.number().int().min(0).max(99_999_999_999_999),
 visible_to_client:z.boolean(),client_action_required:z.boolean(),bindings:operationalEventBindingsSchema,
}).strict().superRefine((value,ctx)=>{
 if(value.client_action_required&&!value.visible_to_client)ctx.addIssue({code:'custom',message:'Ação do cliente exige visibilidade pública.',path:['client_action_required']});
});
export type OperationalEventCreateCommand=z.infer<typeof operationalEventCreateCommandSchema>;
export type OperationalEventCreateInput=Omit<OperationalEventCreateCommand,'version'|'tenant_id'|'actor_id'|'request_id'>;

export const operationalEventResolveCommandSchema=z.object({
 version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,event_id:id,expected_revision:revision,
 resolution:z.string().trim().min(5).max(4000),
}).strict();
export type OperationalEventResolveCommand=z.infer<typeof operationalEventResolveCommandSchema>;
export type OperationalEventResolveInput=Omit<OperationalEventResolveCommand,'version'|'tenant_id'|'actor_id'|'request_id'>;

export type OperationalEventCommand=OperationalEventCreateCommand|OperationalEventResolveCommand;
export type OperationalEventCommandAction='create'|'resolve';

const createContextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,bindings:operationalEventBindingsSchema,revision}).strict();
export type OperationalEventCreateContext=z.infer<typeof createContextSchema>;
export function parseOperationalEventCreateContext(value:unknown,tenant:string,actor:string){
 const parsed=createContextSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor)throw new Error('Contexto da ocorrência incompatível com a sessão. Atualize os dados.');
 return parsed.data;
}

const eventSummarySchema=z.object({id,tenant_id:id,resolved_at:timestamp,public_status:z.string().nullable(),client_action_required:z.boolean()}).passthrough();
const resolveContextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,event_id:id,event:eventSummarySchema,
 can_resolve:z.boolean(),client_message_count:z.number().int().nonnegative(),event_message_count:z.number().int().nonnegative(),revision}).strict();
export type OperationalEventResolveContext=z.infer<typeof resolveContextSchema>;
export function parseOperationalEventResolveContext(value:unknown,tenant:string,actor:string,event:string){
 const parsed=resolveContextSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.event_id!==event
  ||parsed.data.event.id!==event||parsed.data.event.tenant_id!==tenant)throw new Error('Contexto de resolução incompatível com a sessão. Atualize os dados.');
 return parsed.data;
}

const createResultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,command_id:id,event_id:id,
 action:z.literal('create'),confirmed:z.literal(true),public_status:z.string(),revision}).strict();
const resolveResultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,command_id:id,event_id:id,
 action:z.literal('resolve'),confirmed:z.literal(true),public_status:z.literal('resolved'),client_action_required:z.literal(false),
 resolved_at:z.string().datetime({offset:true}),revision}).strict();
export type OperationalEventCreateResult=z.infer<typeof createResultSchema>;
export type OperationalEventResolveResult=z.infer<typeof resolveResultSchema>;
export type OperationalEventCommandResult=OperationalEventCreateResult|OperationalEventResolveResult;

export function parseOperationalEventCommandResult(value:unknown,action:'create',payload:OperationalEventCreateCommand):OperationalEventCreateResult;
export function parseOperationalEventCommandResult(value:unknown,action:'resolve',payload:OperationalEventResolveCommand):OperationalEventResolveResult;
export function parseOperationalEventCommandResult(value:unknown,action:OperationalEventCommandAction,payload:OperationalEventCommand):OperationalEventCommandResult{
 const parsed=action==='create'?createResultSchema.safeParse(value):resolveResultSchema.safeParse(value);
 if(!parsed.success)throw new Error('Confirmação da ocorrência incompatível. Recupere o mesmo pedido.');
 const result=parsed.data;
 if(result.tenant_id!==payload.tenant_id||result.actor_id!==payload.actor_id||result.request_id!==payload.request_id
  ||result.action!==action||('event_id' in payload&&result.event_id!==payload.event_id))throw new Error('A confirmação não corresponde à ocorrência. Recupere o pedido na sessão original.');
 return result;
}

const attemptSchema=z.object({id,previous_attempt_id:id.nullable(),previous_outcome_id:id.nullable(),source_allocation_id:id.nullable(),
 event_id:id,actor_id:id,reason:z.string(),recorded_at:z.string().datetime({offset:true}),is_current:z.boolean()}).strict();
const outcomeSchema=z.object({id,attempt_id:id.nullable(),outcome:z.string(),source:z.string(),load_id:id.nullable(),trip_id:id.nullable(),
 stop_id:id.nullable(),allocation_id:id,event_id:id,occurred_at:z.string().datetime({offset:true}),recorded_at:z.string().datetime({offset:true}),
 reason:z.string().nullable(),is_current:z.boolean(),superseded_by:id.nullable()}).strict();
const proofSchema=z.object({id,version:z.number().int().positive(),status:z.string(),proof_type:z.string().nullable(),load_id:id.nullable(),
 trip_id:id.nullable(),stop_id:id.nullable(),is_active:z.boolean(),retired_event_id:id.nullable(),retired_at:timestamp,
 storage_bucket:z.string().nullable(),storage_path:z.string().nullable(),photo_url:z.string().nullable(),signature_url:z.string().nullable(),
 receiver_name:z.string().nullable(),receiver_document:z.string().nullable(),received_at:timestamp,created_at:timestamp,updated_at:timestamp}).strict();
const allocationSchema=z.object({id,attempt_id:id.nullable(),load_id:id.nullable(),stop_id:id,stop_status:z.string(),destination:z.string().nullable(),
 actual_arrival_at:timestamp,actual_departure_at:timestamp,trip_id:id,trip_status:z.string(),actual_start_at:timestamp,is_current:z.boolean()}).strict();
const occurrenceSchema=z.object({id,event_type:z.string(),severity:z.string(),description:z.string().nullable(),visible_to_client:z.boolean(),
 client_action_required:z.boolean(),public_status:z.string().nullable(),resolved_at:timestamp,created_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true})}).strict();
const currentOutcomeSchema=outcomeSchema.omit({allocation_id:true,event_id:true,is_current:true,superseded_by:true});
export const operatorPodHistorySchema=z.object({
 version:z.literal(1),tenant_id:id,actor_id:id,document_id:id,revision,
 document:z.object({id,document_type:z.string().nullable(),invoice_number:z.string().nullable(),status:z.string(),load_id:id.nullable(),
  client_id:id.nullable(),current_delivery_attempt_id:id.nullable(),updated_at:timestamp}).strict(),
 canonical_state:z.string(),delivered:z.boolean(),proof_available:z.boolean(),arrival_without_outcome:z.boolean(),
 current_outcome:currentOutcomeSchema.nullable(),attempts:z.array(attemptSchema),outcomes:z.array(outcomeSchema),proofs:z.array(proofSchema),
 allocations:z.array(allocationSchema),occurrences:z.array(occurrenceSchema),
}).strict().superRefine((value,ctx)=>{
 const expectedState=value.current_outcome?.outcome??(value.document.current_delivery_attempt_id?'pending_redelivery':'pending');
 const currentOutcomes=value.outcomes.filter(outcome=>outcome.is_current);
 if(value.canonical_state!==expectedState||value.delivered!==(value.current_outcome?.outcome==='delivered')
  ||(value.current_outcome?(currentOutcomes.length!==1||currentOutcomes[0].id!==value.current_outcome.id):currentOutcomes.length!==0)){
  ctx.addIssue({code:'custom',message:'Estado canônico do POD inconsistente.'});
 }
 const expectedArrivalWithoutOutcome=!value.current_outcome&&value.allocations.some(allocation=>!!allocation.actual_arrival_at);
 if(value.arrival_without_outcome!==expectedArrivalWithoutOutcome)ctx.addIssue({code:'custom',message:'Indicador de chegada do POD inconsistente.'});
});
export type OperatorPodHistory=z.infer<typeof operatorPodHistorySchema>;
export function parseOperatorPodHistory(value:unknown,tenant:string,actor:string,document:string){
 const parsed=operatorPodHistorySchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.document_id!==document
  ||parsed.data.document.id!==document)throw new Error('Histórico POD incompatível com a sessão. Atualize a consulta.');
 return parsed.data;
}

type OperatorRpcArgs={
 get_operational_event_create_context:{_tenant_id:string;_bindings:OperationalEventBindings};
 get_operational_event_context:{_tenant_id:string;_event_id:string};
 get_operator_pod_history_v1:{_tenant_id:string;_document_id:string};
 create_operational_event_v1:{_payload:OperationalEventCreateCommand};
 resolve_operational_event_v1:{_payload:OperationalEventResolveCommand};
};
interface RpcResponse{data:unknown;error:unknown}
interface RpcBuilder extends PromiseLike<RpcResponse>{abortSignal:(signal:AbortSignal)=>PromiseLike<RpcResponse>}
const rpc=supabase.rpc as unknown as <Name extends keyof OperatorRpcArgs>(name:Name,args:OperatorRpcArgs[Name])=>RpcBuilder;
export async function callOperatorEventRpc<Name extends keyof OperatorRpcArgs>(name:Name,args:OperatorRpcArgs[Name],signal?:AbortSignal){
 const request=rpc(name,args);return await (signal?request.abortSignal(signal):request);
}

export function operationalEventError(cause:unknown){
 const message=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??''):'';
 if(/not_authorized|permission denied/i.test(message))return 'Sua sessão não tem permissão para alterar ocorrências desta empresa.';
 if(/context_changed|concurrent_change|lock timeout|could not obtain lock/i.test(message))return 'A ocorrência ou seus vínculos mudaram ou estão em uso. Atualize os dados antes de tentar novamente.';
 if(/already_resolved/i.test(message))return 'Esta ocorrência já foi resolvida. Atualize a listagem.';
 if(/binding_(?:not_found|conflict)|visible_requires_client/i.test(message))return 'Os vínculos da ocorrência não correspondem mais aos dados atuais. Atualize a tela.';
 if(/request_key_mismatch|confirmação.*incompatível/i.test(message))return 'A solicitação pendente não corresponde a esta ação. Recupere o pedido original.';
 if(/invalid_payload|invalid_bindings|invalid input syntax|validation/i.test(message))return 'Dados inválidos para registrar a ocorrência. Revise os campos informados.';
 if(/pod_history_document_not_found/i.test(message))return 'NF não encontrada ou indisponível para esta empresa.';
 if(/aborted|fetch|network|tempo esgotado|confirmação pendente|resposta perdida/i.test(message))return 'Confirmação pendente. Recupere a mesma solicitação para evitar duplicidade.';
 return message||'Operação sem confirmação. Recupere o mesmo pedido antes de repetir.';
}

export function operationalEventReadError(cause:unknown,fallback:string){
 const message=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??''):'';
 return /aborted|fetch|network|tempo esgotado/i.test(message)?fallback:operationalEventError(cause);
}
