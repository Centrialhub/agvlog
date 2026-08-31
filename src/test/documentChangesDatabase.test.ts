// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDocumentChangeDatabase,documentChangeIds as i,seedDocumentChanges,documentChangePayload,changeDocuments,documentChangeContext} from './helpers/documentChangesDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createDocumentChangeDatabase();},30000);
beforeEach(async()=>{await seedDocumentChanges(db);});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
  'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
  'operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')})`)).rows);
async function reject(payload:unknown,error:RegExp){const before=await state();await expect(changeDocuments(db,payload)).rejects.toThrow(error);expect(await state()).toBe(before);}
describe('atomic invoice changes candidate with real cleanup trigger',()=>{
 it('attaches an unassigned invoice and updates item/mirror/totals atomically',async()=>{
  const result=await changeDocuments(db,await documentChangePayload(db,'attach',i.load,[i.doc3]));
  expect(result).toMatchObject({updated:1,added:1,load_removed:false,document_ids:[i.doc3],target_stop_id:null});
  expect((await db.query('select total_weight_kg::int,total_pallet_count::int from loads where id=$1',[i.load])).rows[0]).toEqual({total_weight_kg:80,total_pallet_count:4});
  expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc3])).rows[0]).toEqual({load_id:i.load});
 });
 it('attaches a note to exactly the chosen stop on a planned route',async()=>{
  const trips=await twoPlannedTrips(db);await changeDocuments(db,await documentChangePayload(db,'attach',i.load,[i.doc3],{mode:'existing',stop_id:trips.sourceStop}));
  expect((await db.query('select dispatch_stop_id,load_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc3])).rows[0]).toEqual({dispatch_stop_id:trips.sourceStop,load_id:i.load});
  expect((await db.query('select status,actual_start_at from dispatch_trips where id=$1',[trips.sourceTrip])).rows[0]).toEqual({status:'planned',actual_start_at:null});
 });
 it('creates one explicitly located stop and replays without another item or stop',async()=>{
  await twoPlannedTrips(db);const payload=await documentChangePayload(db,'attach',i.load,[i.doc3],{mode:'new',destination:'Novo local',latitude:-23.5,longitude:-46.6});
  const result=await changeDocuments(db,payload);const before=await state();expect(await changeDocuments(db,payload)).toEqual(result);expect(await state()).toBe(before);
  expect((await db.query("select count(*)::int n from dispatch_stops where destination='Novo local'")).rows[0]).toEqual({n:1});
 });
 it('removes an assigned note, retires its empty stop and cancels only its emptied trip',async()=>{
  const trips=await twoPlannedTrips(db);const payload=await documentChangePayload(db,'detach',i.load,[i.doc]);
  const result=await changeDocuments(db,payload);expect(result).toMatchObject({removed:1,load_removed:true,retired_stop_ids:[trips.sourceStop],cancelled_trip_ids:[trips.sourceTrip]});
  expect((await db.query('select status,actual_arrival_at,actual_departure_at from dispatch_stops where id=$1',[trips.sourceStop])).rows[0])
   .toEqual({status:'cancelled',actual_arrival_at:null,actual_departure_at:null});
  expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({load_id:null});
  const before=await state();expect(await changeDocuments(db,payload)).toEqual(result);expect(await state()).toBe(before);
 });
 it('keeps the load and occurrence identities even when its final invoice is removed',async()=>{
  const trips=await twoPlannedTrips(db);await db.query("insert into operational_events(tenant_id,load_id,dispatch_trip_id,dispatch_stop_id,event_type,severity,description) values($1,$2,$3,$4,'other','low','Histórico')",[i.tenant,i.load,trips.sourceTrip,trips.sourceStop]);
  const occurrence=(await db.query('select * from operational_events')).rows;
  expect(await changeDocuments(db,await documentChangePayload(db,'detach',i.load,[i.doc]))).toMatchObject({load_removed:false});
  expect((await db.query('select * from operational_events')).rows).toEqual(occurrence);
 });
 it('preserves other notes on the same stop and does not cancel their trip',async()=>{
  const trips=await twoPlannedTrips(db);await changeDocuments(db,await documentChangePayload(db,'attach',i.load,[i.doc3],{mode:'existing',stop_id:trips.sourceStop}));
  const payload=await documentChangePayload(db,'detach',i.load,[i.doc]);payload.request_id=i.request2;
  expect(await changeDocuments(db,payload)).toMatchObject({load_removed:false,retired_stop_ids:[],cancelled_trip_ids:[]});
  expect((await db.query('select status from dispatch_stops where id=$1',[trips.sourceStop])).rows[0]).toEqual({status:'pending'});
 });
 it('removes all items for a selected invoice without losing manual cargo remaining in the load',async()=>{
  await db.query('insert into load_items(tenant_id,load_id,quantity) values($1,$2,1)',[i.tenant,i.load]);
  const result=await changeDocuments(db,await documentChangePayload(db,'detach',i.load,[i.doc,i.doc2]));expect(result).toMatchObject({removed:2,load_removed:false});
  expect((await db.query('select count(*)::int n from load_items where load_id=$1',[i.load])).rows[0]).toEqual({n:1});
 });
 it.each([
  ['deleted',"update fiscal_documents set deleted_at=now() where id=$1",/invalid_inbound_document/],
  ['outbound',"update fiscal_documents set document_type='outbound' where id=$1",/invalid_inbound_document/],
  ['issued',"update fiscal_documents set cte_emitted_at=now() where id=$1",/fiscal_review/],
 ])('rejects %s documents without changing any business data',async(_label,sql,error)=>{
  await db.query(sql,[i.doc3]);await reject(await documentChangePayload(db,'attach',i.load,[i.doc3]),error);
 });
 it('rejects another load’s invoice instead of silently reassigning it',async()=>{
  await reject(await documentChangePayload(db,'attach',i.load2,[i.doc]),/document_already_linked/);
 });
 it('requires explicit stop selection instead of attaching to the first stop',async()=>{
  await twoPlannedTrips(db);await reject(await documentChangePayload(db,'attach',i.load,[i.doc3]),/explicit_document_stop_required/);
 });
 it('rejects a stop from the wrong trip',async()=>{
  const trips=await twoPlannedTrips(db);await reject(await documentChangePayload(db,'attach',i.load,[i.doc3],{mode:'existing',stop_id:trips.targetStop}),/invalid_replanning_target_stop/);
 });
 it('refuses stale graph/document revision',async()=>{
  const payload=await documentChangePayload(db,'attach',i.load,[i.doc3]);await db.query("update fiscal_documents set product_summary='Alterado' where id=$1",[i.doc3]);
  await reject(payload,/document_change_revision_changed/);
 });
 it('refuses invoice evidence both when adding and removing',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,status,storage_path) values($1,$2,$3,'uploaded','proof')",[i.tenant,i.doc,i.load]);
  await reject(await documentChangePayload(db,'detach',i.load,[i.doc]),/delivery_evidence/);
 });
 it('rejects another tenant’s document in both the read and write API',async()=>{
  const payload=await documentChangePayload(db,'attach',i.load,[i.doc3]);await db.query('update fiscal_documents set tenant_id=$1 where id=$2',[i.otherTenant,i.doc3]);
  await expect(documentChangeContext(db,i.load,[i.doc3])).rejects.toThrow(/document_ownership_mismatch/);await reject(payload,/document_ownership_mismatch/);
 });
 it('rejects changed content with a previously committed request key',async()=>{
  const payload=await documentChangePayload(db,'attach',i.load,[i.doc3]);await changeDocuments(db,payload);await reject({...payload,reason:'Diferente'},/idempotency_mismatch/);
 });
 it('checks membership again on replay',async()=>{
  const payload=await documentChangePayload(db,'attach',i.load,[i.doc3]);await changeDocuments(db,payload);
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await reject(payload,/not_authorized/);
 });
 it('preserves wrapper compatibility for unassigned loads without duplicate items/audits on repetition',async()=>{
  const call=()=>compositionRpc(db,'select assign_fiscal_documents_to_load_v2($1,$2,$3) result',[i.tenant,i.load,[i.doc3]]);
  expect((await call()).rows[0]).toMatchObject({result:{updated:1,totals_recalculated:true}});
  const before=await state();expect((await call()).rows[0]).toMatchObject({result:{added:0}});expect(await state()).toBe(before);
 });
 it('routes legacy removal through stop cleanup and refuses partial item deletion',async()=>{
  const trips=await twoPlannedTrips(db);await compositionRpc(db,'select remove_fiscal_documents_from_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc]]);
  expect((await db.query('select status from dispatch_stops where id=$1',[trips.sourceStop])).rows[0]).toEqual({status:'cancelled'});
  await db.query('insert into load_items(tenant_id,load_id,fiscal_document_id,quantity) values($1,$2,$3,1)',[i.tenant,i.load2,i.doc2]);
  const before=await state();await expect(compositionRpc(db,'select delete_load_item_v3($1,$2)',[i.tenant,i.item2])).rejects.toThrow(/document_remove_requires_document_api/);
  expect(await state()).toBe(before);
 });
 it('keeps new helpers private and exposes only tenant-authorized read/write APIs',async()=>{
  for(const [signature,exposed] of [['_lock_load_document_graph(uuid,uuid)',false],['_load_document_change_snapshot(uuid,uuid,uuid[])',false],
   ['_change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)',false],['get_load_document_change_context(uuid,uuid,uuid[])',true],['change_load_documents(jsonb)',true]] as const){
   expect((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",['public.'+signature])).rows[0])
    .toEqual({anon:false,authenticated:exposed,service:false});
  }
 });
});
