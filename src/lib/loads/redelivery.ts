import {isRecord} from './operationDocumentOutcome';
export const uuidValue=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export interface RedeliveryItem {source_item_id:string;item_description:string;pallet_count:number;weight_kg:number;volume_m3:number}
export interface RedeliveryPayload {tenant_id:string;document_id:string;revision:string;reason:string;items:RedeliveryItem[]}
export interface RedeliveryExpected {loadId:string;tripId:string;stopId:string;outcomeId:string}
export interface RedeliveryResult {request_id:string;tenant_id:string;actor_id:string;document_id:string;attempt_id:string;event_id:string;
 source_load_id:string;source_trip_id:string;source_stop_id:string;previous_outcome_id:string;status:'confirmed';load_id:null;item_count:number;
 historical_allocation_preserved:true;financial_values_preserved:true}
export interface RedeliveryContext {tenant_id:string;actor_id:string;document_id:string;revision:string;load_id:string|null;trip_id:string|null;stop_id:string|null;
 outcome_id:string|null;can_request:boolean;blocking_reason:string|null;document_status:string;invoice_number:string|null;
 remainder:null|{items:Array<{id:string;item_description:string;quantity:number;remaining_quantity:number;pallet_count:number;weight_kg:number|null;volume_m3:number|null}>};
 financial_review:null|{id:string;status:string;total_paid_amount:number;needs_recalculation:boolean}}
const keysOnly=(row:Record<string,unknown>,keys:string[])=>Object.keys(row).every(key=>keys.includes(key));
export function isRedeliveryExpected(value:unknown):value is RedeliveryExpected {
 return isRecord(value)&&keysOnly(value,['loadId','tripId','stopId','outcomeId'])
  &&uuidValue(value.loadId)&&uuidValue(value.tripId)&&uuidValue(value.stopId)&&uuidValue(value.outcomeId);
}
export function isRedeliveryContext(value:unknown):value is RedeliveryContext {
 if(!isRecord(value)||!uuidValue(value.tenant_id)||!uuidValue(value.actor_id)||!uuidValue(value.document_id)
  ||typeof value.revision!=='string'||!/^[0-9a-f]{64}$/.test(value.revision)||typeof value.can_request!=='boolean'
  ||typeof value.document_status!=='string'||(value.invoice_number!==null&&typeof value.invoice_number!=='string')
  ||(value.blocking_reason!==null&&typeof value.blocking_reason!=='string')
  ||!['load_id','trip_id','stop_id','outcome_id'].every(key=>value[key]===null||uuidValue(value[key])))return false;
 if(!value.can_request)return value.remainder===null;
 if(!uuidValue(value.load_id)||!uuidValue(value.trip_id)||!uuidValue(value.stop_id)||!uuidValue(value.outcome_id)
  ||!isRecord(value.remainder)||!Array.isArray(value.remainder.items)||!value.remainder.items.length)return false;
 const ids=new Set<string>();
 return value.remainder.items.every(item=>{
  if(!isRecord(item)||!uuidValue(item.id)||ids.has(item.id)||(item.item_description!==null&&typeof item.item_description!=='string')
   ||typeof item.quantity!=='number'||!Number.isFinite(item.quantity)||item.quantity<=0
   ||typeof item.remaining_quantity!=='number'||!Number.isFinite(item.remaining_quantity)||item.remaining_quantity<=0||item.remaining_quantity>item.quantity
   ||typeof item.pallet_count!=='number'||!Number.isInteger(item.pallet_count)||item.pallet_count<0
   ||!['weight_kg','volume_m3'].every(key=>item[key]===null||typeof item[key]==='number'&&Number.isFinite(item[key])&&item[key]>=0))return false;
  ids.add(item.id);return true;
 });
}
export function isRedeliveryPayload(value:unknown):value is RedeliveryPayload {
 return isRecord(value)&&keysOnly(value,['tenant_id','document_id','revision','reason','items'])&&uuidValue(value.tenant_id)&&uuidValue(value.document_id)
  &&typeof value.revision==='string'&&/^[0-9a-f]{64}$/.test(value.revision)&&typeof value.reason==='string'&&value.reason.trim().length>=5&&value.reason.length<=2000
  &&Array.isArray(value.items)&&value.items.length>0&&new Set(value.items.map(item=>isRecord(item)?item.source_item_id:null)).size===value.items.length
  &&value.items.every(item=>isRecord(item)&&keysOnly(item,['source_item_id','item_description','pallet_count','weight_kg','volume_m3'])&&uuidValue(item.source_item_id)
   &&typeof item.item_description==='string'&&item.item_description.trim().length>0&&item.item_description.length<=2000
   &&typeof item.pallet_count==='number'&&Number.isInteger(item.pallet_count)&&item.pallet_count>=0&&item.pallet_count<=2147483647
   &&['weight_kg','volume_m3'].every(key=>typeof item[key]==='number'&&Number.isFinite(item[key])&&item[key]>=0));
}
export function isConfirmedRedelivery(value:unknown,payload:RedeliveryPayload,expected:RedeliveryExpected,actor:string,request:string):value is RedeliveryResult{
 return isRecord(value)&&value.request_id===request&&value.tenant_id===payload.tenant_id&&value.actor_id===actor&&value.document_id===payload.document_id
  &&uuidValue(value.attempt_id)&&uuidValue(value.event_id)&&value.source_load_id===expected.loadId&&value.source_trip_id===expected.tripId
  &&value.source_stop_id===expected.stopId&&value.previous_outcome_id===expected.outcomeId&&value.status==='confirmed'&&value.load_id===null
  &&value.item_count===payload.items.length&&value.historical_allocation_preserved===true&&value.financial_values_preserved===true;
}
export function redeliveryMessage(error:unknown){
 const raw=error instanceof Error?error.message:isRecord(error)&&typeof error.message==='string'?error.message:'';
 if(raw.includes('context_changed')||raw.includes('concurrent_change'))return 'A nota ou a viagem mudou. Atualize o saldo e confirme novamente os dados físicos; o pedido foi recusado.';
 if(raw.includes('requires_recorded_outcome'))return 'Esta tentativa ainda não tem um resultado auditado para liberar reentrega.';
 if(raw.includes('requires_fiscal_review'))return 'Há documento fiscal emitido nesta nota. A revisão fiscal deve ser concluída antes de liberar o saldo; nenhuma emissão ou cancelamento foi solicitado.';
 if(raw.includes('requires_undelivered_balance'))return 'Não há saldo não entregue elegível para reentrega.';
 if(raw.includes('invalid_redelivery')||raw.includes('Invalid delivery remainder')||raw.includes('requires_entire_balance'))return 'Confira descrição, pallets inteiros, peso e cubagem de todos os itens do saldo.';
 if(isRecord(error)&&error.code==='42501')return 'Sua sessão não tem permissão para liberar reentrega nesta empresa.';
 if(raw.includes('activation_not_ready')||raw.includes('PGRST202'))return 'A reentrega ainda não está disponível neste ambiente. Não tente desmarcar a entrega.';
 return raw||'Não foi possível confirmar a reentrega. Recupere o pedido antes de reenviar.';
}
