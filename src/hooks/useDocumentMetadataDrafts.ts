import {useMemo,useState} from 'react';
import {isMetadataContext,type AdminPatch,type MetadataContext,type MetadataItem} from '@/lib/loads/documentMetadata';

interface Draft {base:MetadataContext;changes:AdminPatch}
interface Document {id:string;operational_metadata?:unknown}
const withoutUnchanged=(changes:AdminPatch,base:MetadataContext):AdminPatch=>Object.fromEntries(
 Object.entries(changes).filter(([field,value])=>base.fields[field as keyof AdminPatch]!==value),
);

// A draft belongs to one actor, tenant, load and reviewed attempt. Refetches never rebase it silently.
export function useDocumentMetadataDrafts(tenant:string|undefined,actor:string|undefined,load:string,documents:Document[],blocked:boolean){
 const scope=`${tenant}:${actor}:${load}`;
 const [state,setState]=useState<{scope:string;rows:Record<string,Draft>}>({scope,rows:{}});
 const contexts=useMemo(()=>new Map(documents.flatMap(document=>{
  const value=document.operational_metadata;
  return isMetadataContext(value)&&value.tenant_id===tenant&&value.load_id===load&&value.document_id===document.id
   ?[[document.id,value] as const]:[];
 })),[documents,tenant,load]);
 const rows=state.scope===scope?state.rows:{};
 const dirty=new Set(Object.keys(rows));
 const stale=Object.keys(rows).filter(id=>contexts.get(id)?.revision!==rows[id].base.revision);
 const canEdit=(id:string)=>!!tenant&&!!actor&&!blocked&&contexts.has(id)&&!stale.includes(id);
 const patch=(id:string,changes:AdminPatch)=>{
  const context=contexts.get(id);if(!context||!canEdit(id))return;
  setState(previous=>{
   const current=previous.scope===scope?previous.rows:{};const existing=current[id];
   if(existing&&existing.base.revision!==context.revision)return previous;
   const base=existing?.base||context;const next={...current};
   const merged=withoutUnchanged({...existing?.changes,...changes},base);
   if(Object.keys(merged).length)next[id]={base,changes:merged};else delete next[id];
   return {scope,rows:next};
  });
 };
 const drop=(ids:string[])=>setState(previous=>{
  if(previous.scope!==scope)return previous;const next={...previous.rows};for(const id of ids)delete next[id];return {scope,rows:next};
 });
 const rebase=()=>{
  if(blocked||Object.entries(rows).some(([id,row])=>{
   const context=contexts.get(id);return !context||context.attempt_id!==row.base.attempt_id||context.outcome_id!==row.base.outcome_id;
  }))return false;
  setState({scope,rows:Object.fromEntries(Object.entries(rows).flatMap(([id,row])=>{
   const base=contexts.get(id)!;const changes=withoutUnchanged(row.changes,base);
   return Object.keys(changes).length?[[id,{base,changes}]]:[];
  }))});return true;
 };
 const items=():MetadataItem[]=>Object.entries(rows).map(([document_id,row])=>({document_id,attempt_id:row.base.attempt_id,revision:row.base.revision,changes:{...row.changes}}));
 return {scope,rows,contexts,dirty,stale,canEdit,patch,drop,rebase,items};
}
