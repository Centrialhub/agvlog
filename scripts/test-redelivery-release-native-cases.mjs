import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {runRedeliveryNative} from './test-redelivery-native-cases.mjs';
export async function runRedeliveryReleaseNative(ctx){
 const {query,session,finish,waitForMarker,literal:q}=ctx;
 const file='supabase/migrations/20260830142048_enable_audited_delivery_reallocation.sql';
 const sha=createHash('sha256').update(readFileSync(file)).digest('hex');assert.equal(sha,'b39c73e86ed3881957b804e5ee5d39e774eeae9f5a425c4ff21402c4922f5987');console.log('SQL_SHA256 '+sha);
 const exports=`export * from './src/test/helpers/deliveryAttemptDatabase.ts';export * from './src/test/helpers/redeliveryDatabase.ts';export * from './src/test/helpers/operationOutcomeDatabase.ts';export * from './src/test/helpers/documentChangesDatabase.ts';export * from './src/test/helpers/planningDatabase.ts';`;
 const bundle=await build({stdin:{contents:exports,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'native-database',setup(b){b.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-db',namespace:'native-db'}));b.onLoad({filter:/.*/,namespace:'native-db'},()=>({contents:'export class PGlite { constructor(){return globalThis.redeliveryNativeDb;} }'}));}}]});
 const h=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 let seq=0;
 async function adapter(database,rolesAlreadyExist=false){
  const state=session('redelivery-fixture',database);state.send('\\set ON_ERROR_STOP off');
  async function execute(sql){const marker='__NATIVE_'+(++seq)+'__';const before=state.output.length,errorBefore=state.error.length;state.send(sql+`;select '${marker}';`);await waitForMarker(state,marker);const errors=state.error.slice(errorBefore);if(/ERROR:/.test(errors))throw Error(errors);return state.output.slice(before).split(marker)[0].trim();}
  const bind=(sql,params)=>sql.replace(/\$(\d+)\b/g,(_,n)=>{const v=params[+n-1];return Array.isArray(v)?q('{'+v.map(x=>String(x)).join(',')+'}'):q(typeof v==='object'&&v!==null?JSON.stringify(v):v);});
  const db={exec:async sql=>execute(rolesAlreadyExist?sql.replace(/create role (anon|authenticated|service_role);/gi,''):sql),query:async(sql,params=[])=>{sql=bind(sql,params).replace(/;\s*$/,'');let wrapped;if(/^\s*(select|with)\b/i.test(sql))wrapped=`select coalesce(jsonb_agg(to_jsonb(native_row)),'[]') from (${sql}) native_row`;else if(/\breturning\b/i.test(sql))wrapped=`with native_row as (${sql}) select coalesce(jsonb_agg(to_jsonb(native_row)),'[]') from native_row`;else{await execute(sql);return{rows:[]};}const raw=await execute(wrapped);return {rows:JSON.parse(raw)};},close:()=>finish(state,'rollback;')};return db;
 }
 const containment=process.env.REDELIVERY_CONTAINMENT==='1';let count=0;if(!containment){const db=await adapter('postgres');globalThis.redeliveryNativeDb=db;
 const initial=await h.createDeliveryAttemptDatabase();await db.exec('begin');await h.seedUndelivered(db,initial.stop);await db.exec('set constraints all immediate;commit');await db.close();
 count=await runRedeliveryNative(ctx); }
 await query('create database redelivery_second_leg');const db2=await adapter('redelivery_second_leg',!containment);globalThis.redeliveryNativeDb=db2;
 const {trip,stop}=await h.createRedeliveryDatabase(),i=h.operationIds;
 await db2.exec('begin');await db2.query('update fiscal_documents set freight_value=125 where id=$1',[i.doc]);await h.seedUndelivered(db2,stop);const firstPayload=await h.redeliveryPayload(db2);const firstResponse=await h.requestRedelivery(db2,firstPayload);
 const p=await h.operationPayload(db2,stop,i.doc2,containment?'returned':'delivered');p.request_id=i.request2;await h.recordOperation(db2,p);

 if(containment){
  const pauseFile='supabase/rollouts/finance_redelivery_140248_containment_local.sql';const pauseSha=createHash('sha256').update(readFileSync(pauseFile)).digest('hex');assert.equal(pauseSha,'893b0342c185037306c474ac4a45419bead7e086b373cbd7f40c2215b2df9744');console.log('CONTAINMENT_SHA256 '+pauseSha);
  const pending=await h.redeliveryPayload(db2,i.doc2);pending.request_id='bc000000-0000-4000-8000-000000000099';
  const snapshot=async()=>(await db2.query("select md5(jsonb_build_object('documents',(select jsonb_agg(to_jsonb(x) order by id) from fiscal_documents x),'items',(select jsonb_agg(to_jsonb(x) order by id) from load_items x),'allocations',(select jsonb_agg(to_jsonb(x) order by id) from dispatch_stop_documents x),'attempts',(select jsonb_agg(to_jsonb(x) order by id) from delivery_attempts x),'events',(select jsonb_agg(to_jsonb(x) order by id) from dispatch_events x),'settlements',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlements x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x),'requests',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from idempotency_keys x))::text) hash")).rows[0].hash;
  await db2.exec('set constraints all immediate;commit');const before=await snapshot();await db2.exec(readFileSync(pauseFile,'utf8'));assert.equal(await snapshot(),before);
  await db2.exec('begin');assert.deepEqual(await h.requestRedelivery(db2,firstPayload),firstResponse);assert.equal(await snapshot(),before);
  await assert.rejects(()=>h.requestRedelivery(db2,pending),/55000.*redelivery_temporarily_paused_preserve_request/s);assert.equal(await snapshot(),before);
  const history=(await h.operationRpc(db2,'select get_load_operational_documents($1,$2) result',[i.tenant,i.load])).rows[0].result;assert.equal(history.documents.find(d=>d.id===i.doc).is_historical,true);
  count++;console.log('PASS containment preserves all business rows and confirmed replay; new request rolls back; historical reader remains usable');
 }
 await h.changeDocuments(db2,await h.documentChangePayload(db2,'attach',i.load2,[i.doc]));
 const planned=h.planningPayload();planned.load_ids=[i.load2];planned.idempotency_key='b1000000-0000-4000-8000-000000000002';planned.stops[0].load_ids=[i.load2];planned.stops[0].fiscal_document_ids=[i.doc];
 const newTrip=(await h.operationRpc(db2,'select dispatch_planned_route($1::jsonb) result',[JSON.stringify(planned)])).rows[0].result;
 const newStop=(await db2.query('select id from dispatch_stops where dispatch_trip_id=$1',[newTrip])).rows[0].id;
 await db2.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await h.operationRpc(db2,'select driver_start_trip($1)',[newTrip]);
 await db2.query("update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp() where id=$1",[newStop]);
 const prefix=`${i.tenant}/deliveries/${newTrip}/${newStop}/`;await db2.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signature.png']);
 const result=(await h.operationRpc(db2,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",[newStop,JSON.stringify({receiver_name:'Recebedor QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signature.png'}),'b1000000-0000-4000-8000-000000000003'])).rows[0].result;
 await db2.exec('set constraints all immediate');assert.equal(result.trip_completed,true);assert.deepEqual(result.applied_document_ids,[i.doc]);
 const settlements=(await db2.query('select dispatch_trip_id,total_freight_revenue::float8 freight,needs_recalculation,recalculation_reason from driver_settlements')).rows;
 assert.equal(settlements.find(x=>x.dispatch_trip_id===trip).freight,125);const next=settlements.find(x=>x.dispatch_trip_id===newTrip);assert.equal(next.freight,0);assert.equal(next.needs_recalculation,true);assert.equal(next.recalculation_reason,'redelivery_pricing_review');assert.equal((await db2.query('select count(*)::int n from driver_settlement_payments')).rows[0].n,0);
 await db2.exec('commit');await db2.close();delete globalThis.redeliveryNativeDb;console.log('PASS native reattach -> plan -> deliver -> real builder preserves first freight and flags second-leg pricing');return count+1;
}
