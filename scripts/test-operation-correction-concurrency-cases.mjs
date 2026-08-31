import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {correctionSql} from '../src/test/helpers/operationCorrectionDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
import {seedItemWriter} from '../src/test/helpers/loadItemWriterDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';
export async function runOperationCorrectionConcurrency({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;const api=operator+'set role authenticated;';
 // Local-only forward restoration after the preceding containment test. This
 // harness owns a disposable loopback cluster; no production preflight is bypassed.
 const proof=readFileSync('supabase/migrations/20260830120554_version_delivery_proof_evidence.sql','utf8').replace(/\r\n/g,'\n');
 function writer(name){const start=proof.indexOf('create or replace function public.'+name+'(');return proof.slice(start,proof.indexOf('$fn$;',proof.indexOf('as $fn$',start))+6);}
 await query('begin;'+writer('record_operation_document_outcome')+writer('driver_record_delivery_outcome')+'commit;');
 let trip=await query(`select trip_id from loads where id=${q(i.load)};`);let stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);
 const driver=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
 async function started(){
  const statements=[];await seedItemWriter({exec:async sql=>{
   const extended=sql.replace('truncate public.driver_settlement_items','truncate public.delivery_document_corrections,public.delivery_document_outcomes,public.driver_settlement_items');
   if(sql.includes('truncate'))assert.notEqual(extended,sql,'The local fixture reset must include immutable correction references');
   statements.push(extended);
  },query:async(sql,params)=>statements.push(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';')});
  // Synthetic fixture reset within this disposable loopback cluster only.
  await query(statements.join('\n'));await query('truncate storage.objects;');
  trip=await query(`${api}select dispatch_planned_route(${q(JSON.stringify(planningPayload()))}::jsonb);`);
  await query(`${driver}select driver_start_trip(${q(trip)});`);
  await query(`update dispatch_trips set actual_start_at=clock_timestamp()-interval '1 hour' where id=${q(trip)};
   update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp()-interval '5 minutes' where dispatch_trip_id=${q(trip)};`);
  stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);
  const c=JSON.parse(await query(`${api}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(i.doc)});`));
  const first={tenant_id:i.tenant,load_id:i.load,document_id:i.doc,stop_id:stop,revision:c.revision,request_id:i.request,
   outcome:'delivered',occurred_at:new Date().toISOString(),receiver_name:'Recebedor QA',reason:'Entrega inicial conferida QA'};
  await query(`${api}select record_operation_document_outcome(${q(JSON.stringify(first))}::jsonb);`);
 }
 const state=()=>query(`select md5(jsonb_build_object('proofs',(select jsonb_agg(to_jsonb(p) order by id) from proof_of_delivery p),
  'documents',(select jsonb_agg(to_jsonb(f) order by id) from fiscal_documents f),'history',(select jsonb_agg(to_jsonb(h) order by id) from delivery_document_outcomes h),
  'loads',(select jsonb_agg(to_jsonb(l) order by id) from loads l),'trips',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trips t),
  'settlements',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlements s),'payments',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlement_payments s),
  'corrections',(select jsonb_agg(to_jsonb(c) order by id) from delivery_document_corrections c),
  'events',(select jsonb_agg(to_jsonb(e) order by id) from dispatch_events e),
  'cache',(select jsonb_agg(to_jsonb(k) order by id) from idempotency_keys k),
  'settlement_items',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlement_items s),
  'settlement_events',(select jsonb_agg(to_jsonb(s) order by id) from driver_settlement_events s))::text);`);
 let serial=10;const payload=async(outcome='not_delivered')=>{
  const c=JSON.parse(await query(`${api}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(i.doc)});`));
  return {tenant_id:i.tenant,load_id:i.load,document_id:i.doc,stop_id:stop,revision:c.revision,correction_of:c.current_outcome_id,
   request_id:`a1000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`,outcome,
   occurred_at:c.history.find(h=>h.id===c.current_outcome_id).occurred_at,reason:'Revisão auditada QA',receiver_name:'Recebedor corrigido QA',
   returned_items:outcome==='partial_delivery'?{[i.item]:0.5}:{}};
 };
 const call=p=>`${api}select record_operation_document_correction(${q(JSON.stringify(p))}::jsonb)`;let original;
 const returnRemaining=async()=>`${driver}select driver_record_delivery_outcome(${q(stop)},'returned',${q(JSON.stringify({notes:'Devolução dos itens restantes QA',returned_items:{[i.item2]:Number(await query(`select quantity from load_items where id=${q(i.item2)};`))}}))}::jsonb,${q(i.request2)},'arrived')`;
 const containment=readFileSync('docs/qa/OPERATION-CORRECTION-CONTAINMENT-2026-08-30.sql','utf8');
 let forwardBody,forwardResult,forwardDefinitions;
 const tests=[
  ['correction migration changes no business or financial records',async()=>{
   const snapshot=()=>query("select md5(jsonb_build_object('proofs',(select jsonb_agg(to_jsonb(t) order by id) from proof_of_delivery t),'docs',(select jsonb_agg(to_jsonb(t) order by id) from fiscal_documents t),'history',(select jsonb_agg(to_jsonb(t) order by id) from delivery_document_outcomes t),'finance',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlements t))::text);");
   const before=await snapshot();await query('begin;'+correctionSql()+'commit;');assert.equal(await snapshot(),before);
  }],
  ['identical concurrent corrections create one replacement and retain all original history',async()=>{
   original=await payload();const prior=await query(`select to_jsonb(h) from delivery_document_outcomes h where id=${q(original.correction_of)};`);
   await contested(call(original),call(original),{driver:false});
   assert.equal(await query('select count(*) from delivery_document_corrections;'),'1');
   assert.equal(await query(`select to_jsonb(h) from delivery_document_outcomes h where id=${q(original.correction_of)};`),prior);
   assert.equal(await query(`select outcome from current_delivery_document_outcomes where fiscal_document_id=${q(i.doc)};`),'not_delivered');
  }],
  ['different concurrent corrections reject the stale revision rather than branching the history',async()=>{
   const first=await payload('partial_delivery');const second={...first,request_id:(await payload()).request_id,outcome:'delivered',returned_items:{}};
   const result=await contested(call(first),call(second),{driver:false,waiterSucceeds:false});assert.match(result.error,/40001/);
   assert.equal(await query('select count(*) from delivery_document_corrections;'),'2');
   assert.equal(await query(`select outcome from current_delivery_document_outcomes where fiscal_document_id=${q(i.doc)};`),'partial_delivery');
  }],
  ['held financial row rejects correction promptly without partial proof retirement',async()=>{
   const p=await payload();const before=await state();const holder=session('correction-financial-holder');
   holder.send('begin;select id from driver_settlements for update;select \'__FINANCE_HELD__\';');await waitForMarker(holder,'__FINANCE_HELD__');
   try{await assert.rejects(()=>query(call(p)),/40001/);}finally{await finish(holder,'rollback;');}assert.equal(await state(),before);
  }],
  ['correction replay rechecks membership revoked while waiting for its request lock',async()=>{
   const before=await state();const key='record_operation_document_correction:'+i.operator+':'+original.request_id;
   const holder=`select pg_advisory_xact_lock(hashtext('record_operation_document_correction'),hashtext(${q(i.tenant+':'+key)}))`;
   const result=await contested(holder,call(original),{driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(result.error,/42501/);await query(`update tenant_memberships set active=true where user_id=${q(i.operator)};`);assert.equal(await state(),before);
  }],
  ...["status='confirmed'","delivery_meta='{}'::jsonb","load_id=null"].map(change=>['commit-time integrity rejects a legacy reset: '+change,async()=>{
   const before=await state();await assert.rejects(()=>query(`begin;${operator}update fiscal_documents set ${change} where id=${q(i.doc)};commit;`),/23514/);assert.equal(await state(),before);
  }]),
  ['paid settlement values are retained and another payment is blocked after correction',async()=>{
   await query("update driver_settlements set needs_recalculation=false;update driver_settlements set status='paid';delete from qa_delivery_side_effects;");
   const financial=()=>query("select md5((to_jsonb(s)-array['needs_recalculation','recalculation_reason','source_updated_at','updated_at'])::text) from driver_settlements s;");
   const before=await financial();await query(call(await payload('returned')));assert.equal(await financial(),before);
   await assert.rejects(()=>query(`${operator}insert into driver_settlement_payments(tenant_id,settlement_id,amount,payment_method,paid_by) select tenant_id,id,10,'pix',${q(i.operator)} from driver_settlements;`),/23514.*settlement_requires_review/);
   assert.equal(await query('select count(*) from driver_settlement_payments;'),'0');assert.equal(await query('select count(*) from qa_delivery_side_effects;'),'0');
  }],
  ['replay of a pre-correction driver receipt cannot overwrite the corrected current result',async()=>{
   const e=JSON.parse(await query("select jsonb_build_object('request',payload->'delivery_request','key',payload->>'client_event_id') from dispatch_events where payload->>'source'='driver_app' and payload ? 'delivery_result' order by event_at desc limit 1;"));
   const before=await state();const replay=JSON.parse(await query(`set request.jwt.claim.sub=${q(i.user)};set role authenticated;select driver_record_delivery_outcome(${q(stop)},${q(e.request.outcome)},${q(JSON.stringify(e.request.details))}::jsonb,${q(e.key)},'arrived');`));
   assert.equal(replay.replayed,true);assert.equal(await state(),before);
  }],
  ['older proof containment refuses the new correction-aware writers without changing history',async()=>{
   const before=await state();await assert.rejects(()=>query(readFileSync('docs/qa/PROOF-VERSION-CONTAINMENT-2026-08-30.sql','utf8')),/Proof containment refused/);assert.equal(await state(),before);
  }],
  ['correction and driver completion serialize while preserving the corrected note and one pending settlement',async()=>{
   await started();const body=await payload('partial_delivery');await contested(call(body),await returnRemaining(),{driver:false});
   assert.equal(await query(`select string_agg(outcome,',' order by fiscal_document_id) from current_delivery_document_outcomes;`),'partial_delivery,returned');
   assert.equal(await query('select count(*) from delivery_document_outcomes;'),'3');
   assert.equal(await query('select count(*) from delivery_document_corrections;'),'1');
   assert.equal(await query("select status||','||needs_recalculation from driver_settlements;"),'pending_review,false');
   assert.equal(await query('select count(*) from driver_settlement_payments;'),'0');
  }],
  ['driver completion winning the trip lock rejects the stale correction and retains the original note result',async()=>{
   await started();const body=await payload('partial_delivery');const rejected=await contested(await returnRemaining(),call(body),{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/40001.*context_changed/);
   assert.equal(await query(`select status from fiscal_documents where id=${q(i.doc)};`),'delivered');
   assert.equal(await query('select count(*) from delivery_document_corrections;'),'0');
   assert.equal(await query('select count(*) from driver_settlements;'),'1');assert.equal(await query('select count(*) from driver_settlement_payments;'),'0');
  }],
  ['correction containment refuses native trigger drift without altering any evidence',async()=>{
   const before=await state();await query('alter table fiscal_documents disable trigger guard_recorded_delivery_document;');
   try{await assert.rejects(()=>query(containment),/Correction containment refused/);}
   finally{await query('alter table fiscal_documents enable trigger guard_recorded_delivery_document;');}
   assert.equal(await state(),before);
  }],
  ['quiesced correction containment suspends three writers and retains current projections and financial review',async()=>{
   forwardBody=await payload('delivered');forwardResult=JSON.parse(await query(call(forwardBody)));
   forwardDefinitions=JSON.parse(await query("select jsonb_agg(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname in('record_operation_document_correction','record_operation_document_outcome','driver_record_delivery_outcome');"));
   const before=await state();await query(containment);
   await assert.rejects(()=>query(call(forwardBody)),/55000/);
   await assert.rejects(()=>query(`${api}select record_operation_document_outcome('{}');`),/55000/);
   await assert.rejects(()=>query(`${driver}select driver_record_delivery_outcome(${q(stop)},'returned');`),/55000/);
   assert.equal(await state(),before);
   assert.equal(JSON.parse(await query(`${api}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(i.doc)});`)).current_outcome_id,forwardResult.history_id);
  }],
  ['correction-aware forward restoration replays the original acknowledgement without new history or payments',async()=>{
   const before=await state();await query('begin;'+forwardDefinitions.join(';\n')+';commit;');
   assert.deepEqual(JSON.parse(await query(call(forwardBody))),forwardResult);assert.equal(await state(),before);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
