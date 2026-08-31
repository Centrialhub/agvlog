import assert from 'node:assert/strict';
import {redeliverySql} from '../src/test/helpers/redeliveryDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';

export async function runRedeliveryNative({query,session,finish,waitForMarker,contested,literal:q}) {
 const api=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const snapshot=()=>query(`select md5(jsonb_build_object(
  'documents',(select jsonb_agg(to_jsonb(f) order by id) from fiscal_documents f),
  'items',(select jsonb_agg(to_jsonb(f) order by id) from load_items f),
  'allocations',(select jsonb_agg(to_jsonb(f) order by id) from dispatch_stop_documents f),
  'outcomes',(select jsonb_agg(to_jsonb(f) order by id) from delivery_document_outcomes f),
  'proofs',(select jsonb_agg(to_jsonb(f) order by id) from proof_of_delivery f),
  'attempts',(select jsonb_agg(to_jsonb(f) order by id) from delivery_attempts f),
  'settlements',(select jsonb_agg(to_jsonb(f) order by id) from driver_settlements f),
  'payments',(select jsonb_agg(to_jsonb(f) order by id) from driver_settlement_payments f))::text);`);
 const context=async()=>JSON.parse(await query(`${api}select get_redelivery_context(${q(i.tenant)},${q(i.doc)});`));
 let payload;let original;let history;
 const call=value=>`${api}select request_document_redelivery(${q(JSON.stringify(value))}::jsonb)`;
 const tests=[
  ['redelivery adapters preserve business rows before any explicit request',async()=>{
   const before=await snapshot();await query('begin;'+redeliverySql()+'commit;');assert.equal(await snapshot(),before);
   const c=await context();assert.equal(c.can_request,true);history=c;
   payload={tenant_id:i.tenant,document_id:i.doc,revision:c.revision,request_id:'bc000000-0000-4000-8000-000000000001',
    reason:'Saldo físico conferido no ensaio nativo QA',items:c.remainder.items.map(item=>({source_item_id:item.id,
     item_description:'Produto conferido QA',pallet_count:1,weight_kg:10,volume_m3:1}))};
   original=await query(`select md5(jsonb_build_object('items',(select jsonb_agg(to_jsonb(x) order by id) from load_items x),
    'allocations',(select jsonb_agg(to_jsonb(x) order by id) from dispatch_stop_documents x),
    'settlements',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlements x),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x))::text);`);
  }],
  ['redelivery grants expose only the intended APIs, not snapshots or definer helpers',async()=>{
   assert.equal(await query("select has_function_privilege('authenticated','request_document_redelivery(jsonb)','execute')||','||has_function_privilege('anon','request_document_redelivery(jsonb)','execute')||','||has_function_privilege('authenticated','_redelivery_context(uuid,uuid)','execute')||','||has_function_privilege('authenticated','_delivery_items_for_stop(uuid)','execute');"),'true,false,false,false');
  }],
  ['redelivery stale revision and other-tenant requests leave all business data unchanged',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(call({...payload,revision:'a'.repeat(64)})+';'),/40001.*redelivery_context_changed/);
   await assert.rejects(()=>query(call({...payload,tenant_id:i.otherTenant})+';'),/42501.*not_authorized/);assert.equal(await snapshot(),before);
  }],
  ['redelivery fails atomically when another session holds an item lock',async()=>{
   const before=await snapshot();const holder=session('redelivery-item-holder');
   holder.send(`begin;select id from load_items where id=${q(i.item)} for update;select '__REDELIVERY_ITEM_HELD__';`);
   await waitForMarker(holder,'__REDELIVERY_ITEM_HELD__');
   try{await assert.rejects(()=>query(call(payload)+';'),/40001.*redelivery_concurrent_change/);}
   finally{await finish(holder,'rollback;');}assert.equal(await snapshot(),before);
  }],
  ['two simultaneous identical release requests commit exactly one attempt',async()=>{
   const before=Number(await query('select count(*) from delivery_attempts;'));await contested(call(payload),call(payload),{driver:false});
   assert.equal(Number(await query('select count(*) from delivery_attempts;')),before+1);
   const first=JSON.parse(await query(call(payload)+';'));assert.equal(first.historical_allocation_preserved,true);assert.equal(first.load_id,null);
  }],
  ['release preserves old items, allocations, settlement amounts and payments byte-for-byte',async()=>{
   const after=await query(`select md5(jsonb_build_object('items',(select jsonb_agg(to_jsonb(x) order by id) from load_items x),
    'allocations',(select jsonb_agg(to_jsonb(x) order by id) from dispatch_stop_documents x),
    'settlements',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlements x),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x))::text);`);assert.equal(after,original);
   const op=JSON.parse(await query(`${api}select get_load_operational_documents(${q(i.tenant)},${q(i.load)});`));
   assert.equal(op.documents.find(d=>d.id===i.doc).status,'returned');assert.equal(op.documents.find(d=>d.id===i.doc).is_historical,true);
   const driver=JSON.parse(await query(`set request.jwt.claim.sub=${q(i.user)};set role authenticated;select get_driver_delivery_items(${q(history.stop_id)});`));
   assert.equal(driver.items.find(item=>item.id===i.item).document_status,'returned');assert.equal(driver.items.find(item=>item.id===i.item).is_historical,true);
  }],
  ['stale metadata saves and distinct requests cannot reset or duplicate the released attempt',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(`update fiscal_documents set delivery_meta='{}' where id=${q(i.doc)};`),/23514.*audited identity/);
   await assert.rejects(()=>query(call({...payload,request_id:'bc000000-0000-4000-8000-000000000002'})+';'),/23514.*requires_recorded_outcome/);
   assert.equal(await snapshot(),before);
  }],
  ['redelivery adapter reapplication is refused without reversing history',async()=>{
   const before=await snapshot();await assert.rejects(()=>query('begin;'+redeliverySql()+'commit;'),/requires untouched attempt foundation/);assert.equal(await snapshot(),before);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
