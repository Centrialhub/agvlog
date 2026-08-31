import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {createCorrectionDatabase} from './operationCorrectionDatabase.ts';
import {operationIds as i,operationPayload,recordOperation,operationRpc} from './operationOutcomeDatabase.ts';
export const attemptFoundationMigration='20260830135338_introduce_delivery_attempt_allocations.sql';
export const attemptFoundationSql=()=>readFileSync('supabase/migrations/'+attemptFoundationMigration,'utf8');
export async function createDeliveryAttemptDatabase(){const result=await createCorrectionDatabase();await result.db.exec(attemptFoundationSql());return result;}
export async function seedUndelivered(db:PGlite,stop:string,outcome='returned'){
 return recordOperation(db,await operationPayload(db,stop,i.doc,outcome));
}
export async function remainder(db:PGlite,history:unknown){
 return (await db.query<{value:{items:Array<{id:string;quantity:number;remaining_quantity:number}>;outcome:string}}>(
  'select _delivery_redelivery_remainder($1) value',[history])).rows[0].value;
}
export async function driverPartial(db:PGlite,trip:string,stop:string,items:Record<string,number>){
 const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
 await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signature.png']);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
 const details={notes:'Entrega parcial conferida QA',receiver_name:'Recebedor QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signature.png',returned_items:items};
 const result=(await operationRpc(db,"select driver_record_delivery_outcome($1,'partial_delivery',$2::jsonb,$3,'arrived') result",[stop,JSON.stringify(details),i.request2])).rows[0].result;
 await db.exec('set constraints guard_recorded_delivery_document immediate;set constraints guard_recorded_delivery_document deferred');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);return result;
}
export async function ownerStatement(db:PGlite,sql:string,params:unknown[]=[]){
 await db.exec('savepoint attempt_test');
 try{const result=await db.query(sql,params);await db.exec('release savepoint attempt_test');return result;}
 catch(error){await db.exec('rollback to savepoint attempt_test;release savepoint attempt_test');throw error;}
}
// Test-only owner construction; there is deliberately no client mutation API.
// Tests are rollback-only. No head is advanced and no cargo is released.
export async function attemptRow(db:PGlite,history:unknown){
 const id=randomUUID();
 const row=(await db.query<{value:Record<string,unknown>}>(`select jsonb_build_object('id',$1::uuid,'tenant_id',h.tenant_id,
  'fiscal_document_id',h.fiscal_document_id,'previous_attempt_id',h.delivery_attempt_id,'previous_outcome_id',h.id,
  'source_allocation_id',h.dispatch_stop_document_id,'actor_id',$2::uuid,'reason','Solicitação de reentrega conferida QA',
  'source_document_snapshot',to_jsonb(f),'source_items_snapshot',(select jsonb_agg(to_jsonb(i) order by id) from load_items i where fiscal_document_id=f.id),
  'financial_snapshot',_delivery_attempt_financial_snapshot(h.tenant_id,h.dispatch_trip_id)) value
  from delivery_document_outcomes h join fiscal_documents f on f.id=h.fiscal_document_id where h.id=$3`,[id,i.operator,history])).rows[0].value;
 const source=await remainder(db,history);
 const items=source.items.map(item=>({id:randomUUID(),source_item_id:item.id,quantity:item.remaining_quantity,
  item_description:'Saldo físico conferido QA',pallet_count:0,weight_kg:1,volume_m3:0.1}));
 const event=(await db.query<{id:string}>(`insert into dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by)
  select tenant_id,dispatch_trip_id,dispatch_stop_id,'redelivery_requested','Reentrega QA',
   jsonb_build_object('source','operation','document_id',fiscal_document_id,'attempt_id',$1::uuid),$2 from delivery_document_outcomes where id=$3 returning id`,[id,i.operator,history])).rows[0].id;
 return {...row,event_id:event,items} as Record<string,unknown> & {items:typeof items};
}
export async function insertAttempt(db:PGlite,row:Record<string,unknown>){
 return ownerStatement(db,`insert into delivery_attempts(id,tenant_id,fiscal_document_id,previous_attempt_id,previous_outcome_id,
  source_allocation_id,event_id,actor_id,reason,source_document_snapshot,source_items_snapshot,financial_snapshot,items)
  select id,tenant_id,fiscal_document_id,previous_attempt_id,previous_outcome_id,source_allocation_id,event_id,actor_id,reason,
   source_document_snapshot,source_items_snapshot,financial_snapshot,items from jsonb_populate_record(null::delivery_attempts,$1::jsonb) returning id`,[JSON.stringify(row)]);
}
