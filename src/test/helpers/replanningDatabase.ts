import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createCompositionDatabase,compositionIds,compositionRpc,seedComposition} from './compositionDatabase.ts';
import {dispatchPlanning,planningPayload} from './planningDatabase.ts';
export const replanningMigration='20260830080608_add_explicit_load_replanning.sql';
export const replanningCandidateSql=readFileSync(`supabase/migrations/${replanningMigration}`,'utf8');
export const replanningIds={...compositionIds,request2:'a0000000-0000-4000-8000-000000000002'};
export async function createReplanningDatabase(){
  const db=await createCompositionDatabase({candidate:true});await db.exec(replanningCandidateSql);return db;
}
export async function seedReplanning(db:PGlite){await seedComposition(db);}
export async function twoPlannedTrips(db:PGlite){
  const i=replanningIds;
  await compositionRpc(db,'select public.move_load_items_between_loads($1,$2,$3,$4)',[i.tenant,i.load,i.load2,[i.item2]]);
  const source=planningPayload();source.stops[0].fiscal_document_ids=[i.doc];
  const target=planningPayload();target.idempotency_key=i.request2;target.load_ids=[i.load2];
  target.stops[0].load_ids=[i.load2];target.stops[0].fiscal_document_ids=[i.doc2];target.stops[0].destination='Destino 2';
  const sourceTrip=await dispatchPlanning(db,source);const targetTrip=await dispatchPlanning(db,target);
  const stops=(await db.query<{id:string;dispatch_trip_id:string}>('select id,dispatch_trip_id from dispatch_stops')).rows;
  return {sourceTrip,targetTrip,sourceStop:stops.find(s=>s.dispatch_trip_id===sourceTrip)!.id,targetStop:stops.find(s=>s.dispatch_trip_id===targetTrip)!.id};
}
export async function replanningContext(db:PGlite){
  const i=replanningIds;const result=await compositionRpc(db,'select public.get_load_replanning_context($1,$2,$3) result',[i.tenant,i.load,i.load2]);
  return (result.rows[0] as {result:{revision:string;stops:{id:string;dispatch_trip_id:string;status:string}[];
    items:{id:string;fiscal_document_id:string|null}[]}}).result;
}
export async function replanningPayload(db:PGlite,targetStop:Record<string,unknown>={mode:'unassigned'}){
  const i=replanningIds;const context=await replanningContext(db);
  return {tenant_id:i.tenant,source_load_id:i.load,target_load_id:i.load2,item_ids:[i.item],request_id:i.request,
    expected_document_ids:context.items.flatMap(item=>item.id===i.item && item.fiscal_document_id?[item.fiscal_document_id]:[]),
    reason:'Ajuste explícito da operação QA',revision:context.revision,target_stop:targetStop};
}
export async function replan(db:PGlite,payload:unknown){
  const result=await compositionRpc(db,'select public.replan_load_items($1::jsonb) result',[JSON.stringify(payload)]);
  return (result.rows[0] as {result:Record<string,unknown>}).result;
}
