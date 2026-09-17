import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const ids={tenant:'20000000-0000-4000-8000-000000000001',actor:'10000000-0000-4000-8000-000000000001'};

export async function runTripMaterializedCorrectionNative({query,literal:q,session,finish}){
 const migration='supabase/migrations/20260914215310_audited_materialized_trip_correction.sql';
 const hash=createHash('sha256').update(readFileSync(migration)).digest('hex');
 assert.equal(hash,'dac12474279bdcd4138191bcb303433ec17d076ac83c4ea40748ee6bcdb27cc2');
 const database='trip_materialized_correction_qa';
 await query(`create database ${database}`);
 const connection=session('trip-materialized-correction-fixture',database);
 async function execute(sql){
  const marker=`__QA_${randomUUID().replaceAll('-','')}__`,offset=connection.output.length;
  connection.send(`${sql};select ${q(marker)};`);
  const deadline=Date.now()+60000;
  while(!connection.output.slice(offset).includes(marker)){
   assert.ok(!connection.exited,connection.error);
   assert.ok(Date.now()<deadline,`Fixture SQL timeout: ${sql.slice(0,180)}`);
   await delay(10);
  }
  return connection.output.slice(offset,connection.output.indexOf(marker,offset));
 }
 const sqlLiteral=value=>value==null?'null':typeof value==='boolean'?String(value):typeof value==='number'?String(value):q(typeof value==='object'?JSON.stringify(value):value);
 const db={
  exec:execute,
  query:async(sql,params=[])=>{
   sql=sql.replace(/\$(\d+)/g,(_,number)=>sqlLiteral(params[Number(number)-1])).replace(/;\s*$/,'');
   if(!/^\s*(select|with)\b/i.test(sql)&&!/\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}
   const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)
    ?`with qa_rows as (${sql}) select coalesce(json_agg(qa_rows),'[]')::text from qa_rows`
    :`select coalesce(json_agg(qa_rows),'[]')::text from (${sql}) qa_rows`;
   return{rows:JSON.parse((await execute(wrapped)).trim()||'[]')};
  },
  close:async()=>{},
 };
 const bundle=await build({
  entryPoints:['src/test/helpers/tripMaterializedCorrectionNativeFixture.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
  plugins:[{name:'native-sql-transport',setup(builder){
   builder.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));
   builder.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__tripMaterializedCorrectionNativeDb}}',loader:'js'}));
  }}],
 });
 globalThis.__tripMaterializedCorrectionNativeDb=db;
 const module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 await module.exports.prepareTripMaterializedCorrectionNativeFixture();
 await finish(connection,'');
 delete globalThis.__tripMaterializedCorrectionNativeDb;

 const run=sql=>query(sql,database);
 const auth=(tenant=ids.tenant,actor=ids.actor)=>`select set_config('request.jwt.claim.sub',${q(actor)},false),set_config('test.tenant',${q(tenant)},false);set role authenticated;`;
 const json=async sql=>JSON.parse((await run(sql)).split(/\r?\n/).filter(Boolean).at(-1));
 const preview=(source,actor=ids.actor)=>json(`${auth(source.tenant,actor)}select preview_dispatch_trip_correction(${q(source.tenant)},${q(source.trip)});`);
 const payload=(source,revision,request=randomUUID())=>({
  version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:request,expected_revision:revision,
  reason:'Correção operacional auditada com todo o histórico preservado',preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true,
 });
 const correct=(command,actor=ids.actor)=>json(`${auth(command.tenant_id,actor)}select correct_dispatch_trip(${q(JSON.stringify(command))}::jsonb);`);
 async function seedTrip({tenant=ids.tenant,actor=ids.actor,materialized=true}={}){
  const trip=randomUUID(),load=randomUUID(),pending=randomUUID(),completed=randomUUID();
  await run(`
   insert into tenants(id) values(${q(tenant)}) on conflict do nothing;
   insert into tenant_memberships(tenant_id,user_id,active,role)
    select ${q(tenant)},${q(actor)},true,'admin'
    where not exists(select 1 from tenant_memberships where tenant_id=${q(tenant)} and user_id=${q(actor)});
   insert into dispatch_trips(id,tenant_id,status,actual_start_at) values(${q(trip)},${q(tenant)},${q(materialized?'in_transit':'planned')},${materialized?`${q('2026-09-14T12:00:00Z')}::timestamptz`:'null'});
   insert into loads(id,tenant_id,trip_id,status) values(${q(load)},${q(tenant)},${materialized?q(trip):'null'},'ready');
   insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values(${q(tenant)},${q(trip)},${q(load)});
   insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values(${q(pending)},${q(tenant)},${q(trip)},'pending');
   ${materialized?`insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,actual_arrival_at,actual_departure_at) values(${q(completed)},${q(tenant)},${q(trip)},'completed','2026-09-14T13:00:00Z','2026-09-14T13:30:00Z');`:''}
   insert into physical_journeys(id,status) values(${q(trip)},'planned');
   insert into physical_journey_trips(physical_journey_id,dispatch_trip_id) values(${q(trip)},${q(trip)});
  `);
  return{tenant,actor,trip,load,pending,completed};
 }
 async function waitFor(state,marker){
  const deadline=Date.now()+6000;
  while(!state.output.includes(marker)){
   assert.ok(!state.exited,`Session exited before ${marker}: ${state.error}`);
   assert.ok(Date.now()<deadline,`Timed out waiting for ${marker}: ${state.error}`);
   await delay(25);
  }
 }
 let passed=0;
 const pass=label=>{passed++;console.log(`PASS ${label}`);};

 const permissions=await json(`select json_build_object(
  'journal_rls',(select relrowsecurity from pg_class where oid='private.dispatch_trip_corrections'::regclass),
  'journal_auth',has_table_privilege('authenticated','private.dispatch_trip_corrections','select'),
  'journal_anon',has_table_privilege('anon','private.dispatch_trip_corrections','select'),
  'public_count',(select count(*) from pg_proc where oid=any(array['public.preview_dispatch_trip_correction(uuid,uuid)'::regprocedure,'public.correct_dispatch_trip(jsonb)'::regprocedure])),
  'public_contract',(select bool_and(prosecdef and proconfig=array['search_path=""']::text[] and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where oid=any(array['public.preview_dispatch_trip_correction(uuid,uuid)'::regprocedure,'public.correct_dispatch_trip(jsonb)'::regprocedure])),
  'private_count',(select count(*) from pg_proc where pronamespace='private'::regnamespace and proname=any(array['dispatch_trip_correction_context','correct_materialized_dispatch_trip','preserve_dispatch_trip_correction','guard_corrected_trip_reference','guard_corrected_trip_stop_reference'])),
  'private_contract',(select bool_and(prosecdef and proconfig=array['search_path=""']::text[] and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where pronamespace='private'::regnamespace and proname=any(array['dispatch_trip_correction_context','correct_materialized_dispatch_trip','preserve_dispatch_trip_correction','guard_corrected_trip_reference','guard_corrected_trip_stop_reference'])),
  'reference_guards',(select count(*) from pg_trigger where not tgisinternal and tgname='guard_materialized_trip_correction'),
  'journal_guard',(select count(*) from pg_trigger where not tgisinternal and tgrelid='private.dispatch_trip_corrections'::regclass and tgname='preserve_dispatch_trip_correction')
 );`);
 assert.deepEqual(permissions,{journal_rls:true,journal_auth:false,journal_anon:false,public_count:2,public_contract:true,private_count:5,private_contract:true,reference_guards:26,journal_guard:1});
 await assert.rejects(()=>run(`set role anon;select preview_dispatch_trip_correction(${q(ids.tenant)},${q(randomUUID())});`),/42501[\s\S]*permission denied/);
 pass('private journal, five definer helpers, two authenticated wrappers and all 26 graph guards have exact ACL metadata');

 let source=await seedTrip(),payable=randomUUID(),document=randomUUID(),allocation=randomUUID();
 await run(`insert into payables(id,tenant_id,dispatch_trip_id) values(${q(payable)},${q(source.tenant)},${q(source.trip)});
  insert into fiscal_documents(id,tenant_id,load_id,document_type,status,cte_emitted_at) values(${q(document)},${q(source.tenant)},${q(source.load)},'inbound','authorized','2026-09-14T11:00:00Z');
  insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values(${q(allocation)},${q(source.tenant)},${q(source.pending)},${q(document)},${q(source.load)});`);
 let beforePayable=await json(`select row_to_json(p) from payables p where id=${q(payable)}`),beforeDocument=await json(`select row_to_json(d) from fiscal_documents d where id=${q(document)}`),beforeAllocation=await json(`select row_to_json(d) from dispatch_stop_documents d where id=${q(allocation)}`);
 let context=await preview(source);
 assert.equal(context.can_execute,true);assert.ok(context.dependency_counts.some(item=>item.code==='payables'));assert.equal(context._evidence,undefined);
 let command=payload(source,context.revision),result=await correct(command),replay=await correct(command);
 assert.deepEqual(replay,result);assert.equal(result.status,'cancelled');assert.equal(result.pending_stops_cancelled,1);assert.equal(result.financial_changed,false);assert.equal(result.fiscal_changed,false);
 await assert.rejects(()=>correct({...command,reason:'Mesmo pedido com conteúdo divergente e auditado'}),/22023[\s\S]*trip_correction_request_conflict/);
 assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'cancelled');
 assert.deepEqual(await json(`select json_object_agg(id,status) from dispatch_stops where dispatch_trip_id=${q(source.trip)}`),{[source.pending]:'cancelled',[source.completed]:'completed'});
 assert.equal(await run(`select trip_id from loads where id=${q(source.load)}`),source.trip);assert.equal(await run(`select count(*) from dispatch_trip_loads where dispatch_trip_id=${q(source.trip)}`),'1');
 assert.deepEqual(await json(`select row_to_json(p) from payables p where id=${q(payable)}`),beforePayable);assert.deepEqual(await json(`select row_to_json(d) from fiscal_documents d where id=${q(document)}`),beforeDocument);assert.deepEqual(await json(`select row_to_json(d) from dispatch_stop_documents d where id=${q(allocation)}`),beforeAllocation);
 assert.equal(await run(`select status from physical_journeys where id=${q(source.trip)}`),'planned');assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'1');assert.equal(await run(`select count(*) from entity_audit_log where entity_id=${q(source.trip)} and action='correct_materialized_trip'`),'1');
 pass('correction cancels only pending work, is idempotent and preserves load, physical, payable and existing fiscal evidence byte-for-byte');

 source=await seedTrip();context=await preview(source);await run(`insert into payables(tenant_id,dispatch_trip_id) values(${q(source.tenant)},${q(source.trip)})`);command=payload(source,context.revision);
 await assert.rejects(()=>correct(command),/40001[\s\S]*trip_correction_revision_changed/);
 assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'in_transit');assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'0');
 const otherTenant='20000000-0000-4000-8000-000000000002',driverActor='10000000-0000-4000-8000-000000000002';
 await run(`insert into tenants(id) values(${q(otherTenant)}) on conflict do nothing;insert into tenant_memberships(tenant_id,user_id,active,role) values(${q(source.tenant)},${q(driverActor)},true,'driver')`);
 await assert.rejects(()=>run(`${auth(otherTenant,ids.actor)}select preview_dispatch_trip_correction(${q(source.tenant)},${q(source.trip)});`),/42501[\s\S]*trip_cancellation_access_denied/);
 await assert.rejects(()=>preview(source,driverActor),/42501[\s\S]*trip_cancellation_access_denied/);
 await run(`update tenant_memberships set active=false where tenant_id=${q(source.tenant)} and user_id=${q(ids.actor)}`);
 await assert.rejects(()=>preview(source),/42501[\s\S]*trip_cancellation_access_denied/);
 await run(`update tenant_memberships set active=true where tenant_id=${q(source.tenant)} and user_id=${q(ids.actor)}`);
 pass('stale revisions, foreign tenants, driver sessions, inactive members and anonymous calls cannot mutate a trip');

 source=await seedTrip();context=await preview(source);const winner=payload(source,context.revision),loser=payload(source,context.revision);
 const holder=session('trip-correction-winner',database);holder.send(`begin;${auth(source.tenant,source.actor)}select correct_dispatch_trip(${q(JSON.stringify(winner))}::jsonb);select '__WINNER_READY__';`);await waitFor(holder,'__WINNER_READY__');
 const waiter=session('trip-correction-loser',database);const rejected=await finish(waiter,`${auth(source.tenant,source.actor)}select correct_dispatch_trip(${q(JSON.stringify(loser))}::jsonb);`,false);assert.match(rejected.error,/40001[\s\S]*trip_correction_concurrent_change/);await finish(holder,'commit;');
 assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'1');assert.equal(await run(`select count(*) from entity_audit_log where entity_id=${q(source.trip)} and action='correct_materialized_trip'`),'1');assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'cancelled');
 pass('two competing corrections yield one committed journal and audit event while the loser fails atomically');

 source=await seedTrip();context=await preview(source);command=payload(source,context.revision);
 const revoker=session('trip-correction-membership-revoker',database);revoker.send(`begin;update tenant_memberships set active=false where tenant_id=${q(source.tenant)} and user_id=${q(source.actor)};select '__MEMBERSHIP_LOCKED__';`);await waitFor(revoker,'__MEMBERSHIP_LOCKED__');
 const racing=session('trip-correction-revoked-member',database);const membershipRace=await finish(racing,`${auth(source.tenant,source.actor)}select correct_dispatch_trip(${q(JSON.stringify(command))}::jsonb);`,false);assert.match(membershipRace.error,/40001[\s\S]*trip_correction_concurrent_change/);await finish(revoker,'commit;');
 assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'in_transit');assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'0');await assert.rejects(()=>correct(command),/42501[\s\S]*trip_cancellation_access_denied/);await run(`update tenant_memberships set active=true where tenant_id=${q(source.tenant)} and user_id=${q(source.actor)}`);
 pass('membership revocation racing the writer leaves no correction and the revoked user cannot retry');

 source=await seedTrip();payable=randomUUID();await run(`insert into payables(id,tenant_id,dispatch_trip_id) values(${q(payable)},${q(source.tenant)},${q(source.trip)})`);context=await preview(source);await correct(payload(source,context.revision));
 await assert.rejects(()=>run(`delete from payables where id=${q(payable)}`),/55000[\s\S]*corrected_trip_history_immutable/);await run(`update payables set tenant_id=tenant_id where id=${q(payable)}`);
 await assert.rejects(()=>run(`insert into payables(tenant_id,dispatch_trip_id) values(${q(source.tenant)},${q(source.trip)})`),/55000[\s\S]*corrected_trip_history_immutable/);
 await assert.rejects(()=>run(`update dispatch_trip_loads set load_id=load_id where dispatch_trip_id=${q(source.trip)}`),/55000[\s\S]*corrected_trip_history_immutable/);
 await run(`update dispatch_trips set updated_at=clock_timestamp() where id=${q(source.trip)}`);await assert.rejects(()=>run(`update dispatch_trips set status='planned' where id=${q(source.trip)}`),/55000[\s\S]*corrected_trip_history_immutable/);
 await assert.rejects(()=>run(`delete from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),/55000[\s\S]*trip_correction_history_immutable/);
 await assert.rejects(()=>run(`insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id) values(${q(randomUUID())},${q(source.tenant)},${q(source.pending)})`),/55000[\s\S]*corrected_trip_stop_history_immutable/);
 pass('corrected trip, load graph, stop documents and journal remain immutable while non-link annotations stay writable');

 source=await seedTrip();await run("alter table entity_audit_log add constraint reject_new_materialized_correction check(action<>'correct_materialized_trip') not valid");context=await preview(source);command=payload(source,context.revision);
 await assert.rejects(()=>correct(command),/23514[\s\S]*reject_new_materialized_correction/);assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'in_transit');assert.equal(await run(`select status from dispatch_stops where id=${q(source.pending)}`),'pending');assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'0');assert.equal(await run(`select count(*) from entity_audit_log where entity_id=${q(source.trip)} and action='correct_materialized_trip'`),'0');
 pass('audit persistence failure rolls back trip, pending stops and correction journal together');

 source=await seedTrip({materialized:false});context=await preview(source);assert.equal(context.clean_planned_trip,true);assert.equal(context.can_execute,false);command=payload(source,context.revision);await assert.rejects(()=>correct(command),/55000[\s\S]*trip_correction_unavailable/);await assert.rejects(()=>correct({...command,unexpected:true}),/22023[\s\S]*invalid_materialized_trip_correction/);assert.equal(await run(`select status from dispatch_trips where id=${q(source.trip)}`),'planned');assert.equal(await run(`select count(*) from private.dispatch_trip_corrections where trip_id=${q(source.trip)}`),'0');
 pass('clean planned trips stay on the cancellation path and malformed correction commands have no side effects');

 console.log(`CANDIDATE ${migration} SHA256 ${hash}`);
 return passed;
}
