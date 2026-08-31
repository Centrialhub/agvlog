import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createRedeliveryDatabase} from './redeliveryDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const documentMetadataMigration='20260830151949_audit_delivery_document_metadata.sql';
export const documentMetadataSql=()=>readFileSync('supabase/migrations/'+documentMetadataMigration,'utf8');
export async function createDocumentMetadataDatabase(){const value=await createRedeliveryDatabase();await value.db.exec(documentMetadataSql());return value;}
export async function metadataContext(db:PGlite,doc=i.doc,load=i.load){
 const result=(await operationRpc<{result:{documents:Array<{id:string;operational_metadata:{revision:string;attempt_id:string|null;fields:Record<string,unknown>;can_receive_receipt:boolean}}>}}>(
  db,'select get_load_operational_documents($1,$2) result',[i.tenant,load])).rows[0].result;
 return result.documents.find(row=>row.id===doc)!.operational_metadata;
}
export async function metadataPayload(db:PGlite,changes:Record<string,unknown>={payment_method:'pix'},doc=i.doc,load=i.load){
 const c=await metadataContext(db,doc,load);return {tenant_id:i.tenant,load_id:load,request_id:'be000000-0000-4000-8000-000000000001',
  reason:'Conferência administrativa da nota QA',items:[{document_id:doc,attempt_id:c.attempt_id,revision:c.revision,changes}]};
}
export async function updateMetadata(db:PGlite,payload:unknown){
 await db.exec('savepoint metadata_test');
 try{const response=(await operationRpc<{result:Record<string,unknown>}>(db,'select update_load_document_metadata($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
  await db.exec('set constraints all immediate;set constraints all deferred;release savepoint metadata_test');return response;
 }catch(error){await db.exec('rollback to savepoint metadata_test;release savepoint metadata_test');throw error;}
}
