import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createReplanningDatabase,replanningIds,seedReplanning} from './replanningDatabase.ts';
import {compositionRpc} from './compositionDatabase.ts';
export const documentChangeMigration='20260830085557_harden_document_composition_changes.sql';
export const documentChangeCandidateSql=readFileSync(`supabase/migrations/${documentChangeMigration}`,'utf8');
export const documentChangeIds={...replanningIds,doc3:'90000000-0000-4000-8000-000000000003'};
export async function installDocumentCleanupFixture(db:PGlite){
  // The captured financial fixture already installs production's cleanup trigger.
  const {rows}=await db.query<{valid:boolean}>(`select exists(select 1 from pg_trigger where tgrelid='public.fiscal_documents'::regclass
    and tgname='trg_cleanup_empty_loads' and tgfoid='public.trg_handle_empty_load_on_doc_change()'::regprocedure
    and tgenabled='O' and tgtype=25 and not tgisinternal) valid`);
  if(!rows[0].valid)throw new Error('Document cleanup trigger fixture differs from production');
}
export async function createDocumentChangeDatabase(){
  const db=await createReplanningDatabase();await installDocumentCleanupFixture(db);await db.exec(documentChangeCandidateSql);return db;
}
export async function seedDocumentChanges(db:PGlite){
  await seedReplanning(db);await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,invoice_number,product_summary,pallet_count,weight_kg) values($1,$2,'inbound','confirmed','333','Documento novo',2,50)",[documentChangeIds.doc3,documentChangeIds.tenant]);
}
export async function documentChangeContext(db:PGlite,load:string,docs:string[]){
  const result=await compositionRpc(db,'select public.get_load_document_change_context($1,$2,$3) result',[documentChangeIds.tenant,load,docs]);
  return (result.rows[0] as {result:{revision:string}}).result;
}
export async function documentChangePayload(db:PGlite,action:'attach'|'detach',load:string,docs:string[],target:Record<string,unknown>={mode:'unassigned'}){
  const context=await documentChangeContext(db,load,docs);return {tenant_id:documentChangeIds.tenant,load_id:load,document_ids:docs,
    request_id:documentChangeIds.request,action,revision:context.revision,reason:'QA alteração explícita de documentos',target_stop:target};
}
export async function changeDocuments(db:PGlite,payload:unknown){
  const result=await compositionRpc(db,'select public.change_load_documents($1::jsonb) result',[JSON.stringify(payload)]);
  return (result.rows[0] as {result:Record<string,unknown>}).result;
}
