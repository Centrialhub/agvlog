import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {operationCandidateSql,operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
import {seedItemWriter} from '../src/test/helpers/loadItemWriterDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';
export async function runOperationOutcomeConcurrency(ctx){
 const {query,contested,literal:q}=ctx;
 await query(`create table public.tenants(id uuid primary key);insert into public.tenants values(${q(i.tenant)}),(${q(i.otherTenant)});
  alter table public.fiscal_documents add column delivery_meta jsonb default '{}';begin;${operationCandidateSql}commit;`);
 const operator=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const driver=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
 const call=p=>`${operator}select record_operation_document_outcome(${q(JSON.stringify(p))}::jsonb)`;
 const recovery=readFileSync('docs/qa/OPERATION-OUTCOMES-RECOVERY-2026-08-30.sql','utf8');
 const recoveryBody=recovery.replaceAll('\r\n','\n').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 const expected=JSON.parse(readFileSync('docs/qa/OPERATION-OUTCOMES-LOCAL-CONTRACTS-2026-08-30.json','utf8'));
 const schemaExpression=recovery.slice(recovery.indexOf("jsonb_build_object('columns'"),recovery.indexOf(")::text) is distinct from '"+expected.historySchemaHash));
 const schemaHash=await query('select md5(('+schemaExpression+')::text);');
 const counts=()=>query(`select (select count(*) from delivery_document_outcomes)||','||(select count(*) from proof_of_delivery)||','||
  (select count(*) from driver_settlements)||','||(select count(*) from driver_settlement_payments);`);
 const state=()=>query(`select jsonb_build_object(${['loads','load_items','dispatch_trips','dispatch_stops','dispatch_stop_documents','fiscal_documents',
  'proof_of_delivery','dispatch_events','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_payments']
  .map(t=>`${q(t)},(select jsonb_agg(to_jsonb(t) order by id) from ${t} t)`).join(',')});`);
 async function started(){const statements=[];await seedItemWriter({exec:async sql=>statements.push(sql.replace('truncate public.driver_settlement_items','truncate public.delivery_document_outcomes,public.driver_settlement_items')),
  query:async(sql,params)=>statements.push(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';')});
  await query(statements.join('\n'));await query('truncate storage.objects;');
  const trip=await query(`${operator}select dispatch_planned_route(${q(JSON.stringify(planningPayload()))}::jsonb);`);
  await query(`${driver}select driver_start_trip(${q(trip)});`);
  await query(`update dispatch_trips set actual_start_at=clock_timestamp()-interval '1 hour' where id=${q(trip)};
   update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp()-interval '5 minutes' where dispatch_trip_id=${q(trip)};`);
  const stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);return {trip,stop};
 }
 async function payload(stop,doc=i.doc,outcome='delivered'){
  const context=JSON.parse(await query(`${operator}select get_operation_document_context(${q(i.tenant)},${q(i.load)},${q(doc)});`));
  return {tenant_id:i.tenant,load_id:i.load,document_id:doc,stop_id:stop,request_id:i.request,revision:context.revision,
   outcome,reason:'Confirmação concorrente QA',receiver_name:'Recebedor QA',occurred_at:new Date().toISOString()};
 }
 const tests=[
  ['history catalog matches the normalized PostgreSQL 17/18 contract',async()=>{assert.equal(schemaHash,expected.historySchemaHash);}],
  ['same operation request waits then returns one history/proof',async()=>{const {stop}=await started(),p=await payload(stop);await contested(call(p),call(p),{driver:false});assert.equal(await counts(),'1,1,0,0');}],
  ['same operation key rejects a changed body after concurrent commit',async()=>{const {stop}=await started(),p=await payload(stop);
   const rejected=await contested(call(p),call({...p,reason:'Outro motivo explícito'}),{driver:false,waiterSucceeds:false});assert.match(rejected.error,/22023.*key_mismatch/);assert.equal(await counts(),'1,1,0,0');}],
  ['different notes serialize and complete one trip/settlement without a payment',async()=>{
   const {stop}=await started(),first=await payload(stop),second=await payload(stop,i.doc2);second.request_id=i.request2;
   await contested(call(first),call(second),{driver:false});assert.equal(await counts(),'2,2,1,0');
   assert.equal(await query(`select status||','||(actual_departure_at is null) from dispatch_stops where id=${q(stop)};`),'delivered,true');
  }],
  ['trip lock followed by document change rejects a stale operation context',async()=>{
   const {trip,stop}=await started(),p=await payload(stop);
   const rejected=await contested(`select id from dispatch_trips where id=${q(trip)} for update`,call(p),{driver:false,waiterSucceeds:false,
    holderAfterBlocked:`update fiscal_documents set delivery_meta=jsonb_build_object('payment_method','pix') where id=${q(i.doc)}`});
   assert.match(rejected.error,/40001.*context_changed/);assert.equal(await counts(),'0,0,0,0');
  }],
  ['operator membership is rechecked after request-key wait',async()=>{
   const {stop}=await started(),p=await payload(stop);const key='record_operation_document_outcome:'+i.operator+':'+i.request;
   const rejected=await contested(`select pg_advisory_xact_lock(hashtext('record_operation_document_outcome'),hashtext(${q(i.tenant+':'+key)}))`,call(p),
    {driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(rejected.error,/42501.*not_authorized/);assert.equal(await counts(),'0,0,0,0');
  }],
  ['driver completion wins against stale operation and keeps its own history',async()=>{
   const {stop}=await started(),p=await payload(stop);
   const driverCall=`${driver}select driver_record_delivery_outcome(${q(stop)},'returned','{"notes":"Devolução conferida"}',${q(i.request2)},'arrived')`;
   const rejected=await contested(driverCall,call(p),{driver:false,waiterSucceeds:false});assert.match(rejected.error,/23514.*requires_started_trip/);assert.equal(await counts(),'2,0,1,0');
  }],
  ['operation non-delivery followed by driver completion preserves both results and original proof state',async()=>{
   const {trip,stop}=await started();await query(call(await payload(stop,i.doc,'not_delivered'))+';');
   const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`,details={receiver_name:'Recebedor QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
   await query(`insert into storage.objects(bucket_id,name) values('receipts',${q(details.photo_paths[0])}),('receipts',${q(details.signature_path)});`);
   await query(`${driver}select driver_record_delivery_outcome(${q(stop)},'delivered',${q(JSON.stringify(details))}::jsonb,${q(i.request2)},'arrived');`);
   assert.equal(await query(`select status from loads where id=${q(i.load)};`),'partial_delivery');assert.equal(await counts(),'2,1,1,0');
   assert.equal(await query(`select status from fiscal_documents where id=${q(i.doc)};`),'not_delivered');
   assert.equal(await query("select string_agg(source,',' order by source) from delivery_document_outcomes;"),'driver,operation');
  }],
  ['operation commit and driver remaining return serialize without counting a completed note twice',async()=>{
   const {stop}=await started(),p=await payload(stop);const quantity=Number(await query(`select quantity from load_items where id=${q(i.item2)};`));
   const details={notes:'Devolução dos itens restantes',returned_items:{[i.item2]:quantity}};
   await contested(call(p),`${driver}select driver_record_delivery_outcome(${q(stop)},'returned',${q(JSON.stringify(details))}::jsonb,${q(i.request2)},'arrived')`,{driver:false});
   assert.equal(await counts(),'2,1,1,0');assert.equal(await query(`select status from fiscal_documents where id=${q(i.doc)};`),'delivered');
   assert.equal(await query(`select status from fiscal_documents where id=${q(i.doc2)};`),'returned');
   assert.equal(await query(`select status from loads where id=${q(i.load)};`),'partial_delivery');
  }],
  ['operational recovery refuses after delivery and preserves finance/history',async()=>{const before=await state();await assert.rejects(()=>query(recovery),/recovery refused: business use exists/);assert.equal(await state(),before);assert.equal(await counts(),'2,1,1,0');}],
  ['operational recovery waits for an operation commit then refuses',async()=>{
   const {stop}=await started(),p=await payload(stop);const rejected=await contested(call(p),recoveryBody,{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/recovery refused: business use exists/);assert.equal(await counts(),'1,1,0,0');
  }],
  ['operational recovery waits for a driver commit then refuses',async()=>{
   const {stop}=await started();const rejected=await contested(`${driver}select driver_record_delivery_outcome(${q(stop)},'returned','{"notes":"Devolução conferida"}',${q(i.request)},'arrived')`,recoveryBody,{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/recovery refused: business use exists/);assert.equal(await counts(),'2,0,1,0');
  }],
  ['operational recovery still detects removal of NOT NULL in native PostgreSQL',async()=>{
   await started();const before=await state();await query('alter table delivery_document_outcomes alter column proof_snapshot drop not null;');
   await assert.rejects(()=>query(recovery),/recovery refused: history schema or privileges changed/);assert.equal(await state(),before);
   await query('alter table delivery_document_outcomes alter column proof_snapshot set not null;');
  }],
  ['unused operational recovery restores then reapplies without changing active trips',async()=>{
   await started();const before=await state();const start=performance.now();await query(recovery);assert.equal(await state(),before);
   assert.equal(await query("select md5(replace(pg_get_functiondef('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)'::regprocedure),E'\\r\\n',E'\\n'));"),'381e01547f4b7b67d1945018151ff3e2');
   await query('begin;'+operationCandidateSql+'commit;');assert.equal(await state(),before);assert.equal(await counts(),'0,0,0,0');
   console.log(`Unused operational recovery + verification + reapplication: ${Math.round(performance.now()-start)} ms (local fixture)`);
  }],
 ];
 for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}return tests.length;
}
