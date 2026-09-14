import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';


// Same TypeScript fixture; only PGlite's client transport is replaced by persistent psql.
export async function runCreditNative({query,contested,literal:q,session,finish}){
 const core='supabase/migrations/20260914200012_audited_planned_trip_cancellation.sql';const frozen=createHash('sha256').update(readFileSync(core)).digest('hex');if(!process.env.PG_QA_CORE_SHA||frozen!==process.env.PG_QA_CORE_SHA)throw Error('Exact reviewed core SHA required');
 const database='finance_credit_qa';await query('create database '+database);const connection=session('open-complement-fixture',database);
 async function execute(sql){const marker='__QA_'+randomUUID().replaceAll('-','')+'__';const offset=connection.output.length;connection.send(sql+';select '+q(marker)+';');const deadline=Date.now()+45000;while(!connection.output.slice(offset).includes(marker)){assert.ok(!connection.exited,connection.error);assert.ok(Date.now()<deadline,'Fixture SQL timeout: '+sql.slice(0,180));await delay(10);}return connection.output.slice(offset,connection.output.indexOf(marker,offset));}
 const literal=v=>v==null?'null':typeof v==='boolean'?String(v):typeof v==='number'?String(v):q(typeof v==='object'?JSON.stringify(v):v);
 const db={exec:execute,query:async(sql,params=[])=>{sql=sql.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1])).replace(/;\s*$/,'');if(!/^\s*(select|with)\b/i.test(sql)&&! /\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)?'with qa_rows as ('+sql+') select coalesce(json_agg(qa_rows),\'[]\')::text from qa_rows':'select coalesce(json_agg(qa_rows),\'[]\')::text from ('+sql+') qa_rows';const text=await execute(wrapped);return{rows:JSON.parse(text.trim()||'[]')};},close:async()=>{}};
 const bundle=await build({entryPoints:['src/test/helpers/tripCancellationDatabase.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'native-sql-transport',setup(b){b.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));b.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__openComplementNativeDb}}',loader:'js'}));}}]});
 globalThis.__openComplementNativeDb=db;const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);const fixture=module.exports;


 await fixture.createTripCancellationDatabase();
 const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
 const identity=`select set_config('request.jwt.claim.sub',${q(actor)},false),set_config('test.tenant',${q(tenant)},false);`;
 const run=sql=>query(identity+sql,database);
 const json=async sql=>JSON.parse((await run(sql)).split('\n').filter(Boolean).at(-1));
 const seed=()=>fixture.seedPlannedCancellationTrip(db);
 const command=async source=>{
  const c=await json(`select private.dispatch_trip_cancellation_context(${q(tenant)},${q(source.trip)})`);assert.equal(c.can_execute,true);
  const p={version:1,tenant_id:tenant,trip_id:source.trip,request_id:randomUUID(),expected_revision:c.revision,reason:'Native audited trip cancellation'};
  return identity+`select private.cancel_planned_dispatch_trip(${q(JSON.stringify(p))}::jsonb)`;
 };
 let source=await seed(),cancel=await command(source),passed=0;
 let r=await contested(cancel,`insert into driver_expenses(tenant_id,dispatch_trip_id) values(${q(tenant)},${q(source.trip)})`,{database,driver:false,waiterSucceeds:false,waitForBlocking:false});
 assert.match(r.error,/40001/);assert.equal(await json(`select count(*) from driver_expenses where dispatch_trip_id=${q(source.trip)}`),0);passed++;console.log('PASS cancellation first rejects concurrent new expense without residue');
 source=await seed();cancel=await command(source);
 r=await contested(`insert into driver_expenses(tenant_id,dispatch_trip_id) values(${q(tenant)},${q(source.trip)})`,cancel,{database,driver:false,waiterSucceeds:false});
 assert.match(r.error,/40001/);assert.equal(await json(`select to_json(status) from dispatch_trips where id=${q(source.trip)}`),'planned');passed++;console.log('PASS expense first makes cancellation preview stale; original expense retained');
 source=await seed();cancel=await command(source);
 r=await contested(cancel,`update dispatch_trips set status='in_transit',actual_start_at=now() where id=${q(source.trip)}`,{database,driver:false,waiterSucceeds:false});
 assert.match(r.error,/55000/);assert.equal(await json(`select to_json(status) from dispatch_trips where id=${q(source.trip)}`),'cancelled');passed++;console.log('PASS cancellation first prevents waiting direct departure from reactivating trip');
 source=await seed();cancel=await command(source);
 r=await contested(`update dispatch_trips set status='in_transit',actual_start_at=now() where id=${q(source.trip)}`,cancel,{database,driver:false,waiterSucceeds:false});
 assert.match(r.error,/40001/);assert.equal(await json(`select to_json(status) from dispatch_trips where id=${q(source.trip)}`),'in_transit');passed++;console.log('PASS direct departure first makes cancellation stale; departure untouched');
 await finish(connection,'');delete globalThis.__openComplementNativeDb;
 assert.equal(createHash('sha256').update(readFileSync(core)).digest('hex'),frozen);return{passed,findings:0};
}
