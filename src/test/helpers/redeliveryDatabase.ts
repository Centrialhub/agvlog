import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createDeliveryAttemptDatabase} from './deliveryAttemptDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const redeliveryMigration='20260830142048_enable_audited_delivery_reallocation.sql';
export const redeliverySql=()=>readFileSync('supabase/migrations/'+redeliveryMigration,'utf8');
export async function createRedeliveryDatabase(){const result=await createDeliveryAttemptDatabase();await result.db.exec(redeliverySql());return result;}
export async function redeliveryContext(db:PGlite,doc=i.doc){
 return (await operationRpc<{result:{revision:string;can_request:boolean;remainder:{items:Array<{id:string;remaining_quantity:number}>}}}>(db,'select get_redelivery_context($1,$2) result',[i.tenant,doc])).rows[0].result;
}
export async function redeliveryPayload(db:PGlite,doc=i.doc){
 const c=await redeliveryContext(db,doc);return {tenant_id:i.tenant,document_id:doc,request_id:'b1000000-0000-4000-8000-000000000001',
  reason:'Saldo físico conferido para nova tentativa QA',revision:c.revision,
  items:c.remainder.items.map(item=>({source_item_id:item.id,item_description:'Produto conferido para reentrega QA',pallet_count:1,weight_kg:12,volume_m3:0.5}))};
}
export async function requestRedelivery(db:PGlite,payload:unknown){
 await db.exec('savepoint redelivery_submission');
 try{
  const result=(await operationRpc(db,'select request_document_redelivery($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result as Record<string,unknown>;
  await db.exec('set constraints all immediate;set constraints all deferred;release savepoint redelivery_submission');return result;
 }catch(error){await db.exec('rollback to savepoint redelivery_submission;release savepoint redelivery_submission');throw error;}
}
