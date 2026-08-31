import {isRecord} from './operationDocumentOutcome';
import {uuidValue} from './redelivery';
export interface AdminFields {rec_canhoto:boolean;payment_method:string;oco_01:string;oco_02:string;resp_oco:string}
export type AdminPatch=Partial<AdminFields>;
export interface MetadataContext {tenant_id:string;load_id:string;document_id:string;attempt_id:string|null;outcome_id:string|null;
 revision:string;status:string;fields:AdminFields;can_receive_receipt:boolean}
export interface MetadataItem {document_id:string;attempt_id:string|null;revision:string;changes:AdminPatch}
export interface MetadataPayload {tenant_id:string;load_id:string;reason:string;items:MetadataItem[]}
export interface MetadataResult {request_id:string;tenant_id:string;actor_id:string;load_id:string;status:'confirmed';document_count:number;
 delivery_outcomes_preserved:true;financial_values_preserved:true;items:Array<{document_id:string;attempt_id:string|null;audit_id:string|null;fields:AdminFields;revision:string;changed:boolean}>}
export const ADMIN_FIELD_LABELS:Record<keyof AdminFields,string>={rec_canhoto:'Canhoto recebido',payment_method:'Forma de pagamento',oco_01:'Ocorrência 01',oco_02:'Ocorrência 02',resp_oco:'Responsável pela ocorrência'};
const fields=Object.keys(ADMIN_FIELD_LABELS);
const strings:Record<string,readonly string[]>={payment_method:['','a_vista','a_prazo','boleto','pix','transferencia','dinheiro','cartao_credito','cartao_debito','cheque','faturado'],
 oco_01:['','01','02','03','04','05','06','07','08','09'],oco_02:['','01','02','03','04','05','06','07','08','09'],
 resp_oco:['','transportadora','cliente','destinatario','remetente','motorista','embarcador']};
const revision=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const nullableId=(value:unknown)=>value===null||uuidValue(value);
const keysOnly=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
export function isAdminFields(value:unknown):value is AdminFields{return isRecord(value)&&typeof value.rec_canhoto==='boolean'
 &&['payment_method','oco_01','oco_02','resp_oco'].every(key=>typeof value[key]==='string');}
export function isAdminPatch(value:unknown):value is AdminPatch{return isRecord(value)&&Object.keys(value).length>0&&keysOnly(value,fields)
 &&Object.entries(value).every(([key,v])=>key==='rec_canhoto'?typeof v==='boolean':typeof v==='string'&&strings[key]?.includes(v));}
export function isMetadataContext(value:unknown):value is MetadataContext{return isRecord(value)&&uuidValue(value.tenant_id)&&uuidValue(value.load_id)
 &&uuidValue(value.document_id)&&nullableId(value.attempt_id)&&nullableId(value.outcome_id)&&revision(value.revision)&&typeof value.status==='string'
 &&isAdminFields(value.fields)&&typeof value.can_receive_receipt==='boolean';}
export function isMetadataPayload(value:unknown):value is MetadataPayload {
 return isRecord(value)&&keysOnly(value,['tenant_id','load_id','reason','items'])&&uuidValue(value.tenant_id)&&uuidValue(value.load_id)
  &&typeof value.reason==='string'&&value.reason.trim().length>=5&&value.reason.length<=2000&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=500
  &&new Set(value.items.map(item=>isRecord(item)?item.document_id:null)).size===value.items.length
  &&value.items.every(item=>isRecord(item)&&keysOnly(item,['document_id','attempt_id','revision','changes'])&&uuidValue(item.document_id)
   &&nullableId(item.attempt_id)&&revision(item.revision)&&isAdminPatch(item.changes));
}
export function isMetadataResult(value:unknown,payload:MetadataPayload,actor:string,request:string):value is MetadataResult {
 if(!isRecord(value)||value.request_id!==request||value.actor_id!==actor||value.tenant_id!==payload.tenant_id||value.load_id!==payload.load_id
  ||value.status!=='confirmed'||value.document_count!==payload.items.length||value.delivery_outcomes_preserved!==true||value.financial_values_preserved!==true
  ||!Array.isArray(value.items)||value.items.length!==payload.items.length)return false;
 const expected=new Map(payload.items.map(item=>[item.document_id,item]));const seen=new Set<string>();
 return value.items.every(row=>{
  if(!isRecord(row)||!uuidValue(row.document_id)||seen.has(row.document_id)||!isAdminFields(row.fields)||!revision(row.revision)
   ||!nullableId(row.audit_id)||typeof row.changed!=='boolean'||row.changed!==(row.audit_id!==null))return false;
  const original=expected.get(row.document_id);const returned=row.fields;
  if(!original||row.attempt_id!==original.attempt_id||!Object.entries(original.changes).every(([key,v])=>returned[key as keyof AdminFields]===v))return false;
  seen.add(row.document_id);return true;
 });
}
export function metadataError(error:unknown){
 const raw=error instanceof Error?error.message:isRecord(error)&&typeof error.message==='string'?error.message:'';
 if(/context_changed|concurrent_change/.test(raw))return 'A nota ou tentativa mudou, ou outra atualização está em andamento. Revise os dados atuais. Se houver pedido pendente, recupere-o antes de enviar outro lote.';
 if(raw.includes('receipt_requires_recorded_outcome'))return 'Registre o resultado auditado desta tentativa antes de confirmar o recebimento do canhoto.';
 if(/invalid_document_metadata|field_not_editable/.test(raw))return 'Confira os campos administrativos. Resultado, data da entrega e vínculos só podem mudar pelas ações auditadas próprias.';
 if(raw.includes('requires_audited_api'))return 'Esta conferência exige a ação auditada; não substitua os metadados da nota.';
 if(isRecord(error)&&error.code==='42501')return 'Sua sessão não tem permissão para conferir estas notas.';
 return raw||'Não foi possível confirmar a conferência. Recupere o pedido antes de reenviar.';
}
