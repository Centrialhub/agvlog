import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createItemWriterDatabase,itemWriterIds,seedItemWriter} from './loadItemWriterDatabase.ts';
import {dispatchPlanning,planningPayload} from './planningDatabase.ts';
import {compositionRpc} from './compositionDatabase.ts';
export const operationIds=itemWriterIds;
export const operationMigration='20260830102652_add_operational_document_outcomes.sql';
export const operationCandidateSql=readFileSync('supabase/migrations/'+operationMigration,'utf8');
// Tests call this inside their rollback-only transaction. Preserve the actual
// SQL error; RESET ROLE in an aborted transaction would otherwise mask it.
export async function operationRpc<Row=Record<string,unknown>>(db:PGlite,sql:string,params:unknown[]=[]){
 await db.exec('savepoint operation_rpc;set role authenticated');
 try{const result=await db.query<Row>(sql,params);await db.exec('reset role;release savepoint operation_rpc');return result;}
 catch(error){await db.exec('rollback to savepoint operation_rpc;release savepoint operation_rpc');throw error;}
}
export async function createOperationDatabase(candidate=true){
 const db=await createItemWriterDatabase();const i=operationIds;
 await db.exec(`create table public.tenants(id uuid primary key);alter table public.fiscal_documents add column delivery_meta jsonb default '{}';`);
 await db.query('insert into public.tenants values($1),($2)',[i.tenant,i.otherTenant]);
 await seedItemWriter(db);const trip=await dispatchPlanning(db,planningPayload());
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
 await compositionRpc(db,'select driver_start_trip($1)',[trip]);
 await db.query("update dispatch_trips set actual_start_at=clock_timestamp()-interval '1 hour' where id=$1",[trip]);
 await db.query("update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp()-interval '5 minutes' where dispatch_trip_id=$1",[trip]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 if(candidate)await db.exec(operationCandidateSql);
 const {rows}=await db.query<{id:string}>('select id from dispatch_stops where dispatch_trip_id=$1 order by id',[trip]);
 return {db,trip,stop:rows[0].id};
}
export async function operationContext(db:PGlite,doc=operationIds.doc){
 const row=(await operationRpc(db,'select get_operation_document_context($1,$2,$3) result',[operationIds.tenant,operationIds.load,doc])).rows[0] as {result:{revision:string;history:unknown[]}};
 return row.result;
}
export async function operationPayload(db:PGlite,stop:string,doc=operationIds.doc,outcome='delivered'){
 return {tenant_id:operationIds.tenant,load_id:operationIds.load,document_id:doc,stop_id:stop,request_id:operationIds.request,
  revision:(await operationContext(db,doc)).revision,outcome,reason:'Conferido pela operação QA',receiver_name:'Recebedor QA',occurred_at:new Date().toISOString()};
}
export async function recordOperation(db:PGlite,payload:unknown){
 return ((await operationRpc(db,'select record_operation_document_outcome($1::jsonb) result',[JSON.stringify(payload)])).rows[0] as {result:Record<string,unknown>}).result;
}
