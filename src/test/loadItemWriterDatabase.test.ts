// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createItemWriterDatabase,itemWriterIds as i,seedItemWriter,itemWriterSignature} from './helpers/loadItemWriterDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createItemWriterDatabase();},30000);
beforeEach(async()=>{await seedItemWriter(db);});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
 'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
 'operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')})`)).rows);
async function reject(sql:string,params:unknown[],pattern:RegExp){const before=await state();await expect(compositionRpc(db,sql,params)).rejects.toThrow(pattern);expect(await state()).toBe(before);}

describe('preparation writer protects item/document/stop integrity',()=>{
 it('creates manual cargo without a trip and updates totals/audit atomically',async()=>{
  const {rows}=await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_item_description=>'Caixa manual',p_quantity=>2,p_pallet_count=>3,p_weight_kg=>40,p_volume_m3=>2) id",[i.tenant,i.load]);
  expect((rows[0] as {id:unknown}).id).toMatch(/^[0-9a-f-]{36}$/);
  expect((await db.query('select total_pallet_count::int,total_weight_kg::int,total_volume_m3::int from loads where id=$1',[i.load])).rows[0]).toEqual({total_pallet_count:5,total_weight_kg:70,total_volume_m3:4});
  expect((await db.query("select count(*)::int n from entity_audit_log where source='item_preparation'")).rows[0]).toEqual({n:1});
 });
 it('edits an existing planned item while retaining its exact invoice and stop allocation',async()=>{
  const trips=await twoPlannedTrips(db);const documents=(await db.query('select * from fiscal_documents order by id')).rows;
  const allocations=(await db.query('select * from dispatch_stop_documents order by id')).rows;
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>3,p_weight_kg=>12,p_status=>'loaded',p_notes=>'Conferido')",[i.tenant,i.item]);
  expect((await db.query('select fiscal_document_id,status,notes from load_items where id=$1',[i.item])).rows[0]).toEqual({fiscal_document_id:i.doc,status:'loaded',notes:'Conferido'});
  expect((await db.query('select * from fiscal_documents order by id')).rows).toEqual(documents);
  expect((await db.query('select * from dispatch_stop_documents order by id')).rows).toEqual(allocations);
  expect((await db.query('select status,actual_start_at from dispatch_trips where id=$1',[trips.sourceTrip])).rows[0]).toEqual({status:'planned',actual_start_at:null});
 });
 it('repeating an unchanged preparation update does not rewrite timestamps or audits',async()=>{
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>'loaded')",[i.tenant,i.item]);const before=await state();
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>'loaded')",[i.tenant,i.item]);expect(await state()).toBe(before);
 });
 it('preserves nullable weight/volume during an unrelated update',async()=>{
  await db.query('update load_items set weight_kg=null,volume_m3=null where id=$1',[i.item]);
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_notes=>'Conferido')",[i.tenant,i.item]);
  expect((await db.query('select weight_kg,volume_m3 from load_items where id=$1',[i.item])).rows[0]).toEqual({weight_kg:null,volume_m3:null});
 });
 it.each(['p_quantity','p_pallet_count','p_weight_kg','p_volume_m3'])('rejects negative %s with no partial writes',async(field)=>{
  await reject(`select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,${field}=>-1)`,[i.tenant,i.item],/invalid_load_item_metrics/);
 });
 it.each(['NaN','Infinity','-Infinity'])('rejects non-finite metric %s',async(value)=>{
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>$3::numeric)',[i.tenant,i.item,value],/invalid_load_item_metrics/);
 });
 it.each([1.5,2147483648])('rejects invalid pallet count %s without rounding',async(value)=>{
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_pallet_count=>$3)',[i.tenant,i.item,value],/invalid_load_item_pallet_count/);
 });
 it.each(['in_transit','delivered','return','redelivery'])('does not manufacture operational outcome %s',async(status)=>{
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>$3)',[i.tenant,i.item,status],/requires_operational_outcome/);
 });
 it('refuses to overwrite an existing physical outcome with a preparation state',async()=>{
  await db.query("update load_items set status='delivered' where id=$1",[i.item]);
  await reject("select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>'pending')",[i.tenant,i.item],/existing_outcome_requires_reconciliation/);
 });
 it('refuses invoice identity replacement on a planned item',async()=>{
  await twoPlannedTrips(db);await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_fiscal_document_id=>$3)',[i.tenant,i.item,i.doc3],/document_identity_immutable/);
 });
 it('refuses the alternate invoice-insertion path while the explicit document API remains available',async()=>{
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_fiscal_document_id=>$3)',[i.tenant,i.load,i.doc3],/use_document_composition_api/);
 });
 it('does not create uncovered manual cargo on an existing planned route',async()=>{
  await twoPlannedTrips(db);await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_quantity=>1)',[i.tenant,i.load],/manual_item_requires_stop_planning/);
 });
 it('locks fiscal metrics after emission but permits preparation notes without altering fiscal data',async()=>{
  await db.query('update fiscal_documents set cte_emitted_at=now() where id=$1',[i.doc]);
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_weight_kg=>500)',[i.tenant,i.item],/metrics_require_fiscal_review/);
  const documents=(await db.query('select * from fiscal_documents order by id')).rows;
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_notes=>'Conferência registrada')",[i.tenant,i.item]);
  expect((await db.query('select * from fiscal_documents order by id')).rows).toEqual(documents);
 });
 it('does not edit items associated with delivery evidence',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status) values($1,$2,'uploaded')",[i.tenant,i.doc]);
  await reject("select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_notes=>'Alterar')",[i.tenant,i.item],/existing_outcome_requires_reconciliation/);
 });
 it('rejects cross-tenant orders and load reassignments',async()=>{
  await db.query('insert into orders values($1,$2)',[i.request,i.otherTenant]);
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_order_id=>$3)',[i.tenant,i.item,i.request],/order_not_found/);
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_load_id=>$3)',[i.tenant,i.item,i.load2],/load_change_requires_move_rpc/);
 });
 it('rejects inactive membership and preserves the restricted API grants',async()=>{
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await reject('select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>2)',[i.tenant,i.item],/not_authorized/);
  expect((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",['public.'+itemWriterSignature])).rows[0]).toEqual({anon:false,authenticated:true,service_role:false});
 });
});
