import assert from 'node:assert/strict';
import {attemptFoundationSql} from '../src/test/helpers/deliveryAttemptDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runDeliveryAttemptFoundationNative({query,session,finish,waitForMarker,contested,literal:q}){
 const api=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const snapshot=()=>query(`select md5(jsonb_build_object(
  'documents',(select jsonb_agg(to_jsonb(f)-'current_delivery_attempt_id' order by id) from fiscal_documents f),
  'items',(select jsonb_agg(to_jsonb(f)-array['delivery_attempt_id','source_delivery_item_id'] order by id) from load_items f),
  'allocations',(select jsonb_agg(to_jsonb(f)-'delivery_attempt_id' order by id) from dispatch_stop_documents f),
  'outcomes',(select jsonb_agg(to_jsonb(f)-'delivery_attempt_id' order by id) from delivery_document_outcomes f),
  'proofs',(select jsonb_agg(to_jsonb(f) order by id) from proof_of_delivery f),
  'settlements',(select jsonb_agg(to_jsonb(f) order by id) from driver_settlements f),
  'payments',(select jsonb_agg(to_jsonb(f) order by id) from driver_settlement_payments f))::text);`);
 const tests=[
  ['attempt foundation preserves all existing business rows and leaves activation closed',async()=>{
   const before=await snapshot();await query('begin;'+attemptFoundationSql()+'commit;');assert.equal(await snapshot(),before);
   assert.equal(await query('select count(*) from delivery_attempts;'),'0');
   assert.equal(await query('select count(*) from fiscal_documents where current_delivery_attempt_id is not null;'),'0');
  }],
  ['native legacy writer cannot add an item to an already recorded attempt',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(`insert into load_items(tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,status)
    select tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,status from load_items where id=${q(i.item)};`),/55000/);
   assert.equal(await snapshot(),before);
  }],
  ['native parent-row conflict rejects legacy item mutation without waiting for a deadlock',async()=>{
   const before=await snapshot();const holder=session('attempt-parent-holder');
   holder.send(`begin;select id from fiscal_documents where id=${q(i.doc)} for update;select '__ATTEMPT_PARENT_HELD__';`);
   await waitForMarker(holder,'__ATTEMPT_PARENT_HELD__');
   try{await assert.rejects(()=>query(`update load_items set quantity=quantity+1 where id=${q(i.item)};`),/40001.*delivery_attempt_concurrent_change/);}
   finally{await finish(holder,'rollback;');}assert.equal(await snapshot(),before);
  }],
  ['native legacy writer cannot delete an original recorded allocation',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(`delete from dispatch_stop_documents where fiscal_document_id=${q(i.doc)};`),/55000/);assert.equal(await snapshot(),before);
  }],
  ['attempt activation rejects owner UPDATE and INSERT before any new head can be visible',async()=>{
   const before=await snapshot();const attempt=q('ab000000-0000-4000-8000-000000000001');
   await assert.rejects(()=>query(`update fiscal_documents set current_delivery_attempt_id=${attempt} where id=${q(i.doc)};`),/55000.*activation_not_ready/);
   await assert.rejects(()=>query(`insert into fiscal_documents(id,tenant_id,document_type,status,current_delivery_attempt_id)
    values(gen_random_uuid(),${q(i.tenant)},'inbound','confirmed',${attempt});`),/55000.*activation_not_ready/);assert.equal(await snapshot(),before);
  }],
  ['attempt private helpers and projections grant no additional authenticated API',async()=>{
   assert.equal(await query("select has_function_privilege('authenticated','_delivery_redelivery_remainder(uuid)','execute')||','||has_function_privilege('authenticated','_delivery_attempt_financial_snapshot(uuid,uuid)','execute')||','||has_table_privilege('authenticated','delivery_attempts','insert')||','||has_table_privilege('authenticated','delivery_allocation_documents','select');"),'false,false,false,false');
   assert.equal(await query("select count(*) from information_schema.views where table_schema='public' and table_name in('current_load_items','current_dispatch_stop_documents') and is_updatable='YES' and is_insertable_into='YES';"),'2');
  }],
  ['existing correction remains atomic and idempotent under the new item guards',async()=>{
   const context=JSON.parse(await query(`${api}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(i.doc)});`));
   const current=context.history.find(h=>h.id===context.current_outcome_id);
   const payload={tenant_id:i.tenant,load_id:i.load,document_id:i.doc,stop_id:context.stops[0].id,revision:context.revision,
    correction_of:current.id,request_id:'ab000000-0000-4000-8000-000000000002',outcome:'returned',occurred_at:current.occurred_at,
    reason:'Revisão nativa após fundação de tentativas QA',returned_items:{}};
   const call=`${api}select record_operation_document_correction(${q(JSON.stringify(payload))}::jsonb)`;
   const count=Number(await query('select count(*) from delivery_document_corrections;'));
   await contested(call,call,{driver:false});assert.equal(Number(await query('select count(*) from delivery_document_corrections;')),count+1);
   const balance=JSON.parse(await query(`select _delivery_redelivery_remainder(id) from current_delivery_document_outcomes where fiscal_document_id=${q(i.doc)};`));
   assert.equal(balance.items[0].remaining_quantity,10);assert.equal(await query('select count(*) from delivery_attempts;'),'0');
  }],
  ['attempt foundation refuses reapplication without overwriting data',async()=>{
   const before=await snapshot();await assert.rejects(()=>query('begin;'+attemptFoundationSql()+'commit;'),/Delivery attempt contract already exists/);assert.equal(await snapshot(),before);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
