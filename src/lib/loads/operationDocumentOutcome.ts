import {isRecord} from './replanning';
export {isRecord};
export const OPERATION_OUTCOMES=['delivered','partial_delivery','returned','refused','failed','not_delivered'] as const;
export type OperationOutcome=typeof OPERATION_OUTCOMES[number];
export const OPERATION_OUTCOME_LABELS:Record<OperationOutcome,string>={delivered:'Entregue',partial_delivery:'Entrega parcial',returned:'Devolvida',refused:'Recusada',failed:'Tentativa sem sucesso',not_delivered:'Não entregue'};
export interface OperationOutcomePayload {tenant_id:string;load_id:string;document_id:string;stop_id:string;revision:string;outcome:OperationOutcome;reason:string;receiver_name:string;occurred_at:string;correction_of?:string;returned_items?:Record<string,number>}
export interface OperationOutcomeResult {request_id:string;tenant_id:string;load_id:string;document_id:string;stop_id:string;outcome:OperationOutcome;event_id:string;history_id:string;pod_id:string|null;proof_pending:boolean;stop_status:string;trip_completed:boolean;correction_of?:string;correction_id?:string;financial_review_required?:boolean;settlement_id?:string|null;settlement_status?:string|null}
export interface OperationDocumentContext {tenant_id:string;load_id:string;document_id:string;document_status:string;revision:string;trip_id:string|null;trip_status:string|null;actual_start_at:string|null;
 stops:{id:string;status:string;destination:string;actual_arrival_at:string|null;actual_departure_at:string|null}[];
 current_outcome_id?:string|null;items?:{id:string;description:string|null;quantity:number}[];settlement?:{id:string;status:string;needs_recalculation:boolean}|null;
 history:{id:string;source:string;outcome:string;occurred_at:string;recorded_at:string;reason:string|null;is_current?:boolean;superseded_by?:string|null}[]}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isOperationOutcomePayload(value:unknown):value is OperationOutcomePayload {
 if(!isRecord(value)||!['tenant_id','load_id','document_id','stop_id'].every(k=>typeof value[k]==='string'&&uuid.test(value[k] as string))
  ||typeof value.revision!=='string'||!/^[0-9a-f]{64}$/.test(value.revision)||!(OPERATION_OUTCOMES as readonly unknown[]).includes(value.outcome)
  ||typeof value.reason!=='string'||value.reason.trim().length<5||value.reason.length>2000||typeof value.receiver_name!=='string'
  ||value.receiver_name.length>160||['delivered','partial_delivery'].includes(String(value.outcome))&&value.receiver_name.trim().length<2
  ||typeof value.occurred_at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value.occurred_at)||!Number.isFinite(Date.parse(value.occurred_at)))return false;
 if(value.correction_of!==undefined){
  if(typeof value.correction_of!=='string'||!uuid.test(value.correction_of))return false;
  if(value.returned_items!==undefined&&(!isRecord(value.returned_items)||Object.entries(value.returned_items).some(([id,n])=>!uuid.test(id)||typeof n!=='number'||!Number.isFinite(n)||n<=0)))return false;
  if(value.outcome==='partial_delivery'&&(!isRecord(value.returned_items)||!Object.keys(value.returned_items).length))return false;
  if(value.outcome!=='partial_delivery'&&isRecord(value.returned_items)&&Object.keys(value.returned_items).length)return false;
 }else if(value.outcome==='partial_delivery'||value.returned_items!==undefined)return false;
 return true;
}
export function isConfirmedOperationOutcome(value:unknown,payload:OperationOutcomePayload,request:string):value is OperationOutcomeResult {
 return isRecord(value)&&value.request_id===request&&['tenant_id','load_id','document_id','stop_id','outcome'].every(k=>value[k]===payload[k as keyof OperationOutcomePayload])
  &&typeof value.event_id==='string'&&uuid.test(value.event_id)&&typeof value.history_id==='string'&&uuid.test(value.history_id)
  &&(['delivered','partial_delivery'].includes(payload.outcome)?typeof value.pod_id==='string'&&uuid.test(value.pod_id):value.pod_id===null)
  &&value.proof_pending===['delivered','partial_delivery'].includes(payload.outcome)&&typeof value.stop_status==='string'&&typeof value.trip_completed==='boolean'
  &&(payload.correction_of?(value.correction_of===payload.correction_of&&value.history_id!==payload.correction_of
   &&typeof value.correction_id==='string'&&uuid.test(value.correction_id)&&typeof value.financial_review_required==='boolean'
   &&(value.financial_review_required?typeof value.settlement_id==='string'&&uuid.test(value.settlement_id)
    &&['pending_review','in_review','reopened','approved','paid','closed'].includes(String(value.settlement_status))
    :value.settlement_id===null&&value.settlement_status===null))
   :value.correction_of===undefined&&value.correction_id===undefined);
}
export function operationResultMessage(result:OperationOutcomeResult){
 if(result.correction_of)return result.financial_review_required?'Correção registrada; acerto preservado e sinalizado para revisão.':result.proof_pending?'Correção registrada; comprovante pendente.':'Correção registrada com histórico preservado.';
 return result.proof_pending?'Resultado confirmado; comprovante pendente.':'Resultado da nota confirmado.';
}
export function operationOutcomeMessage(error:unknown):string {
 const raw=isRecord(error)&&typeof error.message==='string'?error.message:'';
 if(raw.includes('context_changed'))return 'A nota, parada ou comprovante mudou. Revise os dados atualizados antes de confirmar novamente.';
 if(raw.includes('requires_current_outcome'))return 'Selecione o resultado atual registrado. Uma versão anterior não pode ser corrigida novamente.';
 if(raw.includes('requires_recorded_trip'))return 'A correção exige viagem com início registrado. Revise o histórico antes de continuar.';
 if(raw.includes('invalid_quantities'))return 'Informe quantidades devolvidas válidas desta nota. Na parcial, a devolução deve ser menor que o total.';
 if(raw.includes('requires_correction'))return 'A nota já tem resultado final. É necessária correção auditada, não uma nova baixa.';
 if(raw.includes('requires_started_trip'))return 'A baixa exige uma viagem iniciada e ainda em execução.';
 if(raw.includes('requires_arrival'))return 'A parada precisa ter chegada registrada e não estar finalizada.';
 if(raw.includes('operation_correction_invalid_time'))return 'Informe o horário real do resultado, após a chegada e até o fim registrado da viagem, sem data futura.';
 if(raw.includes('invalid_time'))return 'Informe o horário real do resultado, após a chegada e sem data futura.';
 if(raw.includes('proof_requires_review'))return 'Há comprovante existente que exige revisão; ele foi preservado.';
 if(raw.includes('not_authorized'))return 'Sua sessão não tem permissão para registrar resultado nesta empresa.';
 if(raw.includes('invalid_operation_outcome')||raw.includes('invalid_operation_correction'))return 'Informe parada, horário, motivo e recebedor válido para entrega.';
 return raw||'Não foi possível confirmar o resultado operacional.';
}
