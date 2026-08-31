import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createProofVersionDatabase} from './proofVersionDatabase.ts';
import {operationIds as i,operationPayload,recordOperation,operationContext,operationRpc} from './operationOutcomeDatabase.ts';
export const correctionMigration='20260830124944_add_operational_document_corrections.sql';
export const correctionSql=()=>readFileSync('supabase/migrations/'+correctionMigration,'utf8');
export async function createCorrectionDatabase(){const value=await createProofVersionDatabase();await value.db.exec(correctionSql());return value;}
export async function correctionPayload(db:PGlite,stop:string,outcome='not_delivered',doc=i.doc){
 const context=await operationContext(db,doc) as unknown as {revision:string;current_outcome_id:string;history:{id:string;occurred_at:string}[]};
 const current=context.history.find(h=>h.id===context.current_outcome_id);
 if(!current)throw new Error('Expected an existing outcome for correction fixture');
 return {tenant_id:i.tenant,load_id:i.load,document_id:doc,stop_id:stop,revision:context.revision,
  correction_of:current.id,request_id:'a1000000-0000-4000-8000-000000000003',outcome,
  occurred_at:current.occurred_at,receiver_name:'Recebedor corrigido QA',reason:'Correção conferida com a operação QA',returned_items:{} as Record<string,number>};
}
export async function correctOperation(db:PGlite,payload:unknown){
 const result=(await operationRpc(db,'select record_operation_document_correction($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result as Record<string,unknown>;
 await db.exec('set constraints guard_recorded_delivery_document immediate;set constraints guard_recorded_delivery_document deferred');return result;
}
export async function seedCorrectableOutcome(db:PGlite,stop:string,completed=false){
 const first=await recordOperation(db,await operationPayload(db,stop));
 if(completed){const second=await operationPayload(db,stop,i.doc2);second.request_id=i.request2;await recordOperation(db,second);}
 return first;
}
