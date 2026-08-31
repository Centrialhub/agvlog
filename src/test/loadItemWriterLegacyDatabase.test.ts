// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDocumentChangeDatabase,documentChangeIds as i,seedDocumentChanges} from './helpers/documentChangesDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createDocumentChangeDatabase();},30000);
beforeEach(async()=>{await seedDocumentChanges(db);});afterAll(async()=>{await db?.close();});

// Deliberate reproduction against the captured legacy writer, not acceptance
// criteria for its replacement. The document-composition fix cannot cover this API.
describe('legacy item writer bypasses the document-composition contract',()=>{
 it('accepts negative metrics and produces negative totals',async()=>{
  await compositionRpc(db,'select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>-1,p_pallet_count=>-9,p_weight_kg=>-99,p_volume_m3=>-9)',[i.tenant,i.item]);
  expect((await db.query('select quantity::int,pallet_count,weight_kg::int,volume_m3::int from load_items where id=$1',[i.item])).rows[0]).toEqual({quantity:-1,pallet_count:-9,weight_kg:-99,volume_m3:-9});
  expect((await db.query('select total_pallet_count::int,total_weight_kg::int from loads where id=$1',[i.load])).rows[0]).toEqual({total_pallet_count:-8,total_weight_kg:-79});
 });
 it('accepts a non-finite quantity',async()=>{
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>'NaN'::numeric)",[i.tenant,i.item]);
  expect((await db.query('select quantity::text value from load_items where id=$1',[i.item])).rows[0]).toEqual({value:'NaN'});
 });
 it('silently rounds a fractional pallet count',async()=>{
  await compositionRpc(db,'select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_pallet_count=>1.5)',[i.tenant,i.item]);
  expect((await db.query('select pallet_count from load_items where id=$1',[i.item])).rows[0]).toEqual({pallet_count:2});
 });
 it('marks an item delivered while its invoice is confirmed and no trip has started',async()=>{
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>'delivered')",[i.tenant,i.item]);
  expect((await db.query('select i.status item_status,d.status document_status from load_items i join fiscal_documents d on d.id=i.fiscal_document_id where i.id=$1',[i.item])).rows[0]).toEqual({item_status:'delivered',document_status:'confirmed'});
 });
 it('changes invoice identity on a planned item and leaves the original stop allocation behind',async()=>{
  const trip=await twoPlannedTrips(db);
  await compositionRpc(db,'select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_fiscal_document_id=>$3)',[i.tenant,i.item,i.doc3]);
  expect((await db.query('select fiscal_document_id from load_items where id=$1',[i.item])).rows[0]).toEqual({fiscal_document_id:i.doc3});
  expect((await db.query('select fiscal_document_id from dispatch_stop_documents where dispatch_stop_id=$1',[trip.sourceStop])).rows[0]).toEqual({fiscal_document_id:i.doc});
 });
 it('adds a manual item to an already planned load without any stop coverage',async()=>{
  await twoPlannedTrips(db);
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_item_description=>'Mercadoria manual')",[i.tenant,i.load]);
  expect((await db.query('select count(*)::int n from load_items where load_id=$1 and fiscal_document_id is null',[i.load])).rows[0]).toEqual({n:1});
  await expect(db.query('select public._assert_load_replanning_graph($1,$2)',[i.tenant,[i.load]])).rejects.toThrow(/composition_stop_coverage_mismatch/);
 });
 it('inserts an excluded outbound document through the optional fiscal-document argument',async()=>{
  await db.query("update fiscal_documents set document_type='outbound',deleted_at=now() where id=$1",[i.doc3]);
  await compositionRpc(db,'select upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_fiscal_document_id=>$3)',[i.tenant,i.load,i.doc3]);
  expect((await db.query('select count(*)::int n from load_items where fiscal_document_id=$1',[i.doc3])).rows[0]).toEqual({n:1});
 });
});
