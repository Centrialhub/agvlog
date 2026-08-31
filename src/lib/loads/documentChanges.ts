import {isRecord,isUuidList,parseReplanningContext,type ReplanningTarget} from './replanning';
export {isRecord};
export interface DocumentChangePayload {
 tenant_id:string;load_id:string;document_ids:string[];action:'attach'|'detach';revision:string;reason:string;target_stop:ReplanningTarget|null;
}
export interface DocumentChangeResult {
 request_id:string;load_id:string;action:'attach'|'detach';document_ids:string[];document_count:number;updated:number;removed:number;added:number;
 load_removed:boolean;target_stop_id:string|null;retired_stop_ids:string[];cancelled_trip_ids:string[];totals_recalculated:true;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isDocumentChangePayload(value:unknown):value is DocumentChangePayload {
 if(!isRecord(value)||typeof value.tenant_id!=='string'||!uuid.test(value.tenant_id)||typeof value.load_id!=='string'||!uuid.test(value.load_id)
  ||!isUuidList(value.document_ids)||!value.document_ids.length||typeof value.revision!=='string'||!/^[0-9a-f]{64}$/.test(value.revision)
  ||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)return false;
 if(value.action==='detach')return value.target_stop===null;
 if(value.action!=='attach'||!isRecord(value.target_stop))return false;
 const target=value.target_stop;
 if(target.mode==='unassigned')return true;
 if(target.mode==='existing')return typeof target.stop_id==='string'&&uuid.test(target.stop_id);
 return target.mode==='new'&&typeof target.destination==='string'&&!!target.destination.trim()
  &&typeof target.latitude==='number'&&Number.isFinite(target.latitude)&&Math.abs(target.latitude)<=90
  &&typeof target.longitude==='number'&&Number.isFinite(target.longitude)&&Math.abs(target.longitude)<=180
  &&(target.client_id===null||typeof target.client_id==='string'&&uuid.test(target.client_id));
}
export function parseDocumentChangeContext(value:unknown,load:string,documents:string[]){
 if(!isRecord(value)||!isRecord(value.graph)||!Array.isArray(value.documents)||value.documents.length!==documents.length
  ||!value.documents.every(d=>isRecord(d)&&typeof d.id==='string'&&documents.includes(d.id))
  ||new Set(value.documents.map(d=>isRecord(d)?d.id:null)).size!==documents.length)
  throw new Error('O servidor não confirmou os documentos. Atualize a seleção.');
 return parseReplanningContext({...value.graph,revision:value.revision},load,load);
}
export function isConfirmedDocumentChange(value:unknown,payload:DocumentChangePayload,request:string):value is DocumentChangeResult {
 if(!isRecord(value)||value.request_id!==request||value.load_id!==payload.load_id||value.action!==payload.action
  ||!isUuidList(value.document_ids)||value.document_ids.length!==payload.document_ids.length||!value.document_ids.every(id=>payload.document_ids.includes(id))
  ||value.document_count!==payload.document_ids.length||typeof value.load_removed!=='boolean'||value.totals_recalculated!==true
  ||!isUuidList(value.retired_stop_ids)||!isUuidList(value.cancelled_trip_ids))return false;
 if(payload.action==='detach')return value.added===0&&value.updated===0&&typeof value.removed==='number'
  &&Number.isInteger(value.removed)&&value.removed>=payload.document_ids.length&&value.target_stop_id===null;
 if(value.added!==payload.document_ids.length||value.updated!==payload.document_ids.length||value.removed!==0||value.load_removed)return false;
 return payload.target_stop?.mode==='unassigned'?value.target_stop_id===null
  :payload.target_stop?.mode==='existing'?value.target_stop_id===payload.target_stop.stop_id
   :typeof value.target_stop_id==='string'&&uuid.test(value.target_stop_id);
}
