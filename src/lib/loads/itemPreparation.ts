import {isRecord} from './replanning';
export {isRecord};
export const PREPARATION_STATUSES=['pending','waiting_conference','in_stock','picking','ready_for_load','in_loading','loaded','divergence'] as const;
export type PreparationStatus=typeof PREPARATION_STATUSES[number];
export interface ItemPreparationValues {
 order_id?:string;item_description?:string;quantity?:number;pallet_count?:number;weight_kg?:number;volume_m3?:number;status?:PreparationStatus;notes?:string;
}
export type ItemPreparationExpected=Partial<Record<keyof ItemPreparationValues,string|number|null>>;
export interface ItemPreparationPayload {tenant_id:string;load_id:string;item_id:string|null;values:ItemPreparationValues;expected:ItemPreparationExpected|null}
export interface ItemPreparationResult {request_id:string;tenant_id:string;load_id:string;item_id:string;created:boolean;totals_recalculated:true;values:ItemPreparationExpected}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=['order_id','item_description','quantity','pallet_count','weight_kg','volume_m3','status','notes'];
export function isItemPreparationPayload(value:unknown):value is ItemPreparationPayload {
 if(!isRecord(value)||typeof value.tenant_id!=='string'||!uuid.test(value.tenant_id)||typeof value.load_id!=='string'||!uuid.test(value.load_id)
  ||!(value.item_id===null||typeof value.item_id==='string'&&uuid.test(value.item_id))||!isRecord(value.values)||!Object.keys(value.values).length)return false;
 for(const [key,item] of Object.entries(value.values)){
  if(!fields.includes(key))return false;
  if(['quantity','pallet_count','weight_kg','volume_m3'].includes(key)){
   if(typeof item!=='number'||!Number.isFinite(item)||item<0||key==='pallet_count'&&(!Number.isInteger(item)||item>2147483647))return false;
  }else if(typeof item!=='string'||key==='order_id'&&!uuid.test(item)||key==='status'&&!(PREPARATION_STATUSES as readonly string[]).includes(item))return false;
 }
 if(value.item_id===null)return value.expected===null;
 if(!isRecord(value.expected)||!Object.keys(value.values).every(key=>Object.prototype.hasOwnProperty.call(value.expected,key)))return false;
 return Object.entries(value.expected).every(([key,item])=>fields.includes(key)&&(item===null||typeof item==='string'||typeof item==='number'&&Number.isFinite(item)));
}
export function isConfirmedItemPreparation(value:unknown,payload:ItemPreparationPayload,request:string):value is ItemPreparationResult {
 if(!isRecord(value)||value.request_id!==request||value.tenant_id!==payload.tenant_id||value.load_id!==payload.load_id
  ||typeof value.item_id!=='string'||!uuid.test(value.item_id)||payload.item_id!==null&&value.item_id!==payload.item_id
  ||value.created!==(payload.item_id===null)||value.totals_recalculated!==true||!isRecord(value.values))return false;
 return Object.entries(payload.values).every(([key,item])=>isRecord(value.values)&&value.values[key]===item);
}
export function itemPreparationMessage(error:unknown):string {
 const value=isRecord(error)?error:{};const raw=typeof value.message==='string'?value.message:'';
 if(raw.includes('invalid_load_item_metrics')||raw.includes('invalid_load_item_pallet_count'))return 'Quantidade, peso e volume devem ser finitos e não negativos; paletes devem ser inteiros.';
 if(raw.includes('requires_operational_outcome')||raw.includes('existing_outcome_requires_reconciliation'))return 'Trânsito, entrega, devolução e reentrega devem ser registrados pelo fluxo operacional, preservando a viagem e os comprovantes.';
 if(raw.includes('manual_item_requires_stop_planning'))return 'Esta carga já tem rota planejada. O item manual precisa de alocação de parada e entrega; nenhum item foi incluído.';
 if(raw.includes('metrics_require_fiscal_review'))return 'A nota já possui emissão fiscal. Revise o documento antes de alterar as quantidades; nenhuma emissão foi solicitada.';
 if(raw.includes('expected_changed'))return 'Este campo foi alterado por outra operação. Atualize o item antes de escolher novamente.';
 if(raw.includes('document_identity_immutable')||raw.includes('use_document_composition_api'))return 'Use a inclusão ou realocação de notas para alterar a composição documental.';
 if(raw.includes('load_locked'))return 'A carga ou viagem está bloqueada para edição da preparação.';
 return raw||'Não foi possível confirmar a preparação do item.';
}
