import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installProofReaderFixture,proofVersionSql,seedHistoricalProof} from '../src/test/helpers/proofVersionDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runProofVersionConcurrency({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;
 const api=operator+'set role authenticated;';
 const adapter={exec:sql=>query(sql),query:async(sql,params=[])=>{
  const body=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]));
  const rows=JSON.parse(await query(operator+`with qa_result as (${body}) select coalesce(json_agg(to_jsonb(r)),'[]'::json) from qa_result r;`));return {rows};
 }};
 // The preceding operational suite leaves a fresh, started two-note trip.
 await installProofReaderFixture(adapter);
 const trip=await query(`select trip_id from loads where id=${q(i.load)};`);
 const stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);
 const state=()=>query(`select md5(jsonb_build_object('proofs',(select jsonb_agg(to_jsonb(p) order by id) from proof_of_delivery p),
  'documents',(select jsonb_agg(to_jsonb(f) order by id) from fiscal_documents f),'history',(select jsonb_agg(to_jsonb(h) order by id) from delivery_document_outcomes h),
  'settlements',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlements s),'payments',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlement_payments s))::text);`);
 const call=p=>`${api}select record_operation_document_outcome(${q(JSON.stringify(p))}::jsonb)`;
 const payload=async()=>{const c=JSON.parse(await query(`${api}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(i.doc)});`));
  return {tenant_id:i.tenant,load_id:i.load,document_id:i.doc,stop_id:stop,request_id:i.request,revision:c.revision,
   outcome:'delivered',reason:'Recebimento confirmado QA',receiver_name:'Recebedor QA',occurred_at:new Date().toISOString()};};
 let old;let original;
 const tests=[
  ['proof version migration changes no existing business or financial evidence',async()=>{const before=await state();await query('begin;'+proofVersionSql()+'commit;');assert.equal(await state(),before);}],
  ['retired proof keeps original evidence while one concurrent request creates exactly one new version',async()=>{
   old=await seedHistoricalProof(adapter,trip,stop);original=await query(`select to_jsonb(p) from proof_of_delivery p where id=${q(old.proof)};`);
   const p=await payload();await contested(call(p),call(p),{driver:false});
   assert.equal(await query(`select string_agg(version||':'||is_active,',' order by version) from proof_of_delivery where fiscal_document_id=${q(i.doc)};`),'1:false,2:true');
   assert.equal(await query(`select to_jsonb(p) from proof_of_delivery p where id=${q(old.proof)};`),original);
  }],
  ['a second logical confirmation cannot replace the current proof or add another version',async()=>{
   const before=await state();const p=await payload();p.request_id=i.request2;
   await assert.rejects(()=>query(call(p)),/requires_correction/);assert.equal(await state(),before);
  }],
  ['driver completion preserves manual and historical proofs and completes one pending settlement without payment',async()=>{
   const previous=await seedHistoricalProof(adapter,trip,stop,i.doc2);
   const previousState=await query(`select to_jsonb(p) from proof_of_delivery p where id=${q(previous.proof)};`);
   const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`,details={receiver_name:'Recebedor motorista QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
   await query(`insert into storage.objects(bucket_id,name) values('receipts',${q(details.photo_paths[0])}),('receipts',${q(details.signature_path)});`);
   await query(`set request.jwt.claim.sub=${q(i.user)};set role authenticated;select driver_record_delivery_outcome(${q(stop)},'delivered',${q(JSON.stringify(details))}::jsonb,${q(i.request2)},'arrived');`);
   assert.equal(await query(`select to_jsonb(p) from proof_of_delivery p where id=${q(previous.proof)};`),previousState);
   assert.equal(await query(`select (select count(*) from proof_of_delivery)||','||(select count(*) from current_delivery_proofs)||','||
    (select count(*) from driver_settlements)||','||(select count(*) from driver_settlement_payments);`),'4,2,1,0');
  }],
  ['historical proof mutation is refused natively and retains its original row',async()=>{
   await assert.rejects(()=>query(`update proof_of_delivery set storage_path='changed' where id=${q(old.proof)};`),/55000.*immutable/);
   assert.equal(await query(`select to_jsonb(p) from proof_of_delivery p where id=${q(old.proof)};`),original);
  }],
  ['held operator membership prevents retirement without changing a receipt',async()=>{
   const event=await query(`${operator}insert into dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by)
    values(${q(i.tenant)},${q(trip)},${q(stop)},'operation_document_correction','Revisão auditada QA',
    jsonb_build_object('source','operation','document_id',${q(i.doc)}),${q(i.operator)}) returning id;`);
   const before=await state();const holder=session('proof-membership-holder');
   holder.send(`begin;select tenant_id from tenant_memberships where user_id=${q(i.operator)} for update;select '__MEMBER_HELD__';`);
   await waitForMarker(holder,'__MEMBER_HELD__');
   try{await assert.rejects(()=>query(`${operator}select _retire_delivery_proof(${q(i.tenant)},${q(i.doc)},${q(event)});`),/55P03/);}
   finally{await finish(holder,'rollback;');}
   assert.equal(await state(),before);
  }],
  ['authenticated clients cannot mutate proof rows or call private preparation',async()=>{
   const before=await state();await assert.rejects(()=>query(`${api}update proof_of_delivery set is_active=false;`),/42501/);
   await assert.rejects(()=>query(`${api}select _prepare_delivery_proof(${q(i.tenant)},${q(i.doc)},${q(trip)},${q(stop)});`),/42501/);assert.equal(await state(),before);
  }],
  ['older operational recovery refuses the new version-aware writers and retains all evidence',async()=>{
   const before=await state();await assert.rejects(()=>query(readFileSync('docs/qa/OPERATION-OUTCOMES-RECOVERY-2026-08-30.sql','utf8')),/recovery refused/);assert.equal(await state(),before);
  }],
  ['quiesced writer containment retains native history, pending settlement and current-proof readers',async()=>{
   const before=await state();const readers=await query("select md5(string_agg(pg_get_functiondef(oid),',' order by proname)) from pg_proc where proname in('get_client_portal_shipment_detail','get_client_portal_shipment_detail_v2');");
   await query(readFileSync('docs/qa/PROOF-VERSION-CONTAINMENT-2026-08-30.sql','utf8'));
   await assert.rejects(()=>query(`${api}select record_operation_document_outcome('{}'::jsonb);`),/55000/);
   await assert.rejects(()=>query(`set request.jwt.claim.sub=${q(i.user)};set role authenticated;select driver_record_delivery_outcome(${q(stop)},'delivered');`),/55000/);
   assert.equal(await state(),before);
   assert.equal(await query("select md5(string_agg(pg_get_functiondef(oid),',' order by proname)) from pg_proc where proname in('get_client_portal_shipment_detail','get_client_portal_shipment_detail_v2');"),readers);
   assert.equal(await query('select count(*) from current_delivery_proofs;'),'2');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
