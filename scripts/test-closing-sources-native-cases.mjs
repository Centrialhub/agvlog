import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closingSourcesSql,installClosingSourcesFixture} from '../src/test/helpers/closingSourcesDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runClosingSourcesNative({query,session,finish,waitForMarker,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;const api=operator+'set role authenticated;';
 const adapter={exec:sql=>query(sql),query:async(sql,params=[])=>{
  const body=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]));
  const rows=JSON.parse(await query(operator+`with qa_result as (${body}) select coalesce(json_agg(to_jsonb(r)),'[]'::json) from qa_result r;`));return {rows};
 }};
 await installClosingSourcesFixture(adapter);
 const day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 const filters={period_start:day,period_end:day,date_basis:'delivery_result'};
 const call=`${api}select get_closing_report_sources(${q(i.tenant)},${q(JSON.stringify(filters))}::jsonb);`;
 const read=async()=>JSON.parse(await query(call));
 const state=()=>query(`select md5(jsonb_build_object('documents',(select jsonb_agg(to_jsonb(f) order by id) from fiscal_documents f),
  'items',(select jsonb_agg(to_jsonb(f) order by id) from load_items f),'attempts',(select jsonb_agg(to_jsonb(f) order by id) from delivery_attempts f),
  'outcomes',(select jsonb_agg(to_jsonb(f) order by id) from delivery_document_outcomes f),'payments',(select jsonb_agg(to_jsonb(f) order by id) from driver_settlement_payments f))::text);`);
 const tests=[
  ['closing source migration and repeated reads preserve operational/financial evidence',async()=>{
   const before=await state();const sql=closingSourcesSql();await query('begin;'+sql+'commit;');
   const first=await read();assert.equal(first.complete,true);assert.ok(first.documents.some(d=>d.document.id===i.doc));assert.deepEqual(await read(),first);
   assert.equal(await state(),before);console.log('Closing sources candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
  }],
  ['closing private source retains old allocation plus the unallocated redelivery, with reserved quantities',async()=>{
   const rows=JSON.parse(await query(`select jsonb_agg(source order by source->>'key') from _closing_attempt_document_sources(${q(i.tenant)}) where source->'document'->>'id'=${q(i.doc)};`));
   assert.equal(rows.length,2);assert.equal(rows.find(d=>d.historical).document.load_id,i.load);
   const current=rows.find(d=>!d.historical);assert.equal(current.document.load_id,null);assert.equal(current.document.freight_value,0);
   assert.equal(current.outcome,null);assert.equal(current.financial_review_required,true);assert.equal(current.physical.source,'reserved_attempt');assert.ok(current.physical.quantity>0);
  }],
  ['closing source API denies another tenant, a driver and direct private-helper access',async()=>{
   await assert.rejects(()=>query(call.replace(q(i.tenant),q(i.otherTenant))),/42501.*not_authorized/);
   await assert.rejects(()=>query(call.replace(q(i.operator),q(i.user))),/42501.*not_authorized/);
   await assert.rejects(()=>query(`${api}select * from _closing_attempt_document_sources(${q(i.tenant)});`),/42501.*permission denied/);
   assert.equal(await query("select has_function_privilege('anon','get_closing_report_sources(uuid,jsonb)','execute')||','||has_function_privilege('service_role','get_closing_report_sources(uuid,jsonb)','execute');"),'false,false');
  }],
  ['closing read uses one committed MVCC snapshot during a concurrent fiscal update',async()=>{
   await query(`insert into cte_documents(id,tenant_id,cte_number,freight_value,load_ids,fiscal_document_ids,status,sefaz_status,sefaz_environment,is_voided)
    values('ce000000-0000-4000-8000-000000000051',${q(i.tenant)},'CTE-NATIVE-QA',100,array[${q(i.load)}]::uuid[],array[${q(i.doc)},${q(i.doc2)}]::uuid[],'authorized','authorized','production',false);`);
   const before=await read();assert.equal(before.fiscal_candidates[0].freight_value,100);
   const holder=session('closing-source-fiscal-holder');holder.send("begin;update cte_documents set freight_value=250 where id='ce000000-0000-4000-8000-000000000051';select '__CLOSING_FISCAL_HELD__';");
   await waitForMarker(holder,'__CLOSING_FISCAL_HELD__');try{assert.deepEqual(await read(),before);}finally{await finish(holder,'commit;');}
   const after=await read();assert.equal(after.fiscal_candidates[0].freight_value,250);assert.notEqual(after.revision,before.revision);
   assert.deepEqual(after.documents,before.documents);assert.deepEqual(after.allocation_documents,before.allocation_documents);
  }],
  ['closing source reads honor membership revocation on the next transaction',async()=>{
   await query(`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);
   try{await assert.rejects(()=>read(),/42501.*not_authorized/);}finally{await query(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}
  }],
  ['closing source migration refuses reapplication without resetting history',async()=>{
   const before=await state();await assert.rejects(()=>query('begin;'+closingSourcesSql()+'commit;'),/Closing sources require/);assert.equal(await state(),before);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
