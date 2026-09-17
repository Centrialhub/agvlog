import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {financeIds as ids} from '../src/test/helpers/financeLedgerDatabase.ts';

export async function runDriverAdvanceReturnsNative({query,contested,literal:q,session,finish}){
 const migration='supabase/migrations/20260914220500_finance_driver_advance_recorded_returns.sql';
 const migrationHash=createHash('sha256').update(readFileSync(migration)).digest('hex');
 assert.equal(migrationHash,'1f50a50dff97f7a3cf3b5892e0eea538b7d7f7fb2f7cff176b3710a3b6755938');
 const database='finance_driver_advance_returns_qa';
 await query(`create database ${database}`);
 const connection=session('driver-advance-return-fixture',database);
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
   const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)?`with qa_rows as (${sql}) select coalesce(json_agg(qa_rows),'[]')::text from qa_rows`:`select coalesce(json_agg(qa_rows),'[]')::text from (${sql}) qa_rows`;
   const text=await execute(wrapped);
   return{rows:JSON.parse(text.trim()||'[]')};
  },
  close:async()=>{},
 };
 const bundle=await build({entryPoints:['src/test/helpers/driverAdvanceReturnNativeFixture.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'native-sql-transport',setup(builder){builder.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));builder.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__driverAdvanceReturnNativeDb}}',loader:'js'}));}}]});
 globalThis.__driverAdvanceReturnNativeDb=db;
 const module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 await module.exports.prepareDriverAdvanceReturnNativeFixture();
 await finish(connection,'');
 delete globalThis.__driverAdvanceReturnNativeDb;

 const otherDriver='30000000-0000-4000-8000-000000000002';
 const identity=`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);`;
 const authenticated=`${identity}set role authenticated;`;
 const run=sql=>query(sql,database);
 const json=async sql=>JSON.parse((await run(sql)).split('\n').filter(Boolean).at(-1));
 const base=(tenant=ids.tenant)=>({version:1,tenant_id:tenant,request_id:randomUUID(),reason:'Devolução real conferida em disputa nativa do PostgreSQL'});
 const movement=async({tenant=ids.tenant,account=ids.account,driver=ids.driver,direction,amount,description})=>{
  const payload={...base(tenant),bank_account_id:account,direction,nature:direction==='out'?'driver_advance':'refund',driver_id:driver,amount_cents:amount,occurred_on:'2026-09-01',description,beneficiary_name:'Motorista QA'};
  return(await json(`${authenticated}select record_finance_movement(${q(JSON.stringify(payload))}::jsonb);`)).movement_id;
 };
 async function seed({tenant=ids.tenant,account=ids.account,driver=ids.driver,allocated=45000}={}){
  const advance=await movement({tenant,account,driver,direction:'out',amount:50000,description:'PIX enviado ao motorista'});
  const incoming=await movement({tenant,account,driver,direction:'in',amount:5000,description:'Devolução recebida do motorista'});
  if(allocated){
   const batch=randomUUID(),expense=randomUUID();
   await run(`insert into finance_expense_batches(id,tenant_id,context,description,created_by) values(${q(batch)},${q(tenant)},'office','Prestação de contas QA',${q(ids.operator)});insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) values(${q(expense)},${q(tenant)},${q(batch)},'fuel','Gastos conferidos',${allocated},'2026-09-01','Fornecedores da viagem','Recibos conferidos',${q(ids.operator)});insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values(${q(tenant)},${q(expense)},${q(advance)},${allocated},${q(ids.operator)});`);
  }
  return{tenant,advance,incoming};
 }
 const payload=async(source,requestId=randomUUID())=>{
  const preview=await json(`${authenticated}select preview_finance_driver_advance_return(${q(source.tenant)},${q(source.advance)},${q(source.incoming)},'5000');`);
  assert.equal(preview.eligible,true,JSON.stringify(preview.blockers));
  return{...base(source.tenant),request_id:requestId,advance_movement_id:source.advance,incoming_movement_id:source.incoming,amount_cents:'5000',expected_revision:preview.revision};
 };
 const record=command=>`${authenticated}select record_finance_driver_advance_return(${q(JSON.stringify(command))}::jsonb);`;
 const race=(first,second,options={})=>contested(first,second,{database,driver:false,...options});
 const scopedCount=(table,source)=>run(`select count(*) from ${table} where tenant_id=${q(source.tenant)} and advance_movement_id=${q(source.advance)}`);
 let count=0;
 const pass=label=>{console.log(`PASS ${label}`);count++;};

 let source=await seed(),command=await payload(source),before=await run(`select jsonb_agg(to_jsonb(m) order by id) from finance_movements m where id in(${q(source.advance)},${q(source.incoming)})`);
 let result=await race(record(command),record(command));
 const raced=JSON.parse(result.output.split('\n').filter(Boolean).at(-1)),replayed=await json(record(command));
 assert.deepEqual(replayed,raced);assert.equal(await scopedCount('finance_private.driver_advance_returns',source),'1');assert.equal(await run(`select count(*) from finance_events where tenant_id=${q(source.tenant)} and entity_id=${q(source.advance)} and action='driver_advance_return_recorded'`),'1');assert.equal(await run(`select count(*) from finance_commands where tenant_id=${q(source.tenant)} and request_id=${q(command.request_id)}`),'1');assert.equal(await run(`select finance_private.movement_used_cents(${q(source.tenant)},${q(source.advance)})::text||','||finance_private.receipt_movement_used_cents(${q(source.tenant)},${q(source.incoming)})::text`),'50000,5000');assert.equal(await run(`select jsonb_agg(to_jsonb(m) order by id) from finance_movements m where id in(${q(source.advance)},${q(source.incoming)})`),before);
 pass('same request waits, replays one return and leaves both bank movements immutable');

 source=await seed();const first=await payload(source),second=await payload(source);result=await race(record(first),record(second),{waiterSucceeds:false});assert.match(result.error,/40001[\s\S]*finance_driver_advance_return_changed/);assert.equal(await scopedCount('finance_private.driver_advance_returns',source),'1');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(second.request_id)}`),'0');
 pass('different requests cannot consume the same open advance balance twice');

 source=await seed();const competingAdvance=await movement({direction:'out',amount:5000,description:'Segundo adiantamento em disputa'});const competing={tenant:ids.tenant,advance:competingAdvance,incoming:source.incoming};const advanceCommand=await payload(source),competingCommand=await payload(competing);result=await race(record(advanceCommand),record(competingCommand),{waiterSucceeds:false});assert.match(result.error,/40001[\s\S]*finance_driver_advance_return_changed/);assert.equal(await run(`select count(*) from finance_private.driver_advance_returns where incoming_movement_id=${q(source.incoming)}`),'1');assert.equal(await run(`select finance_private.receipt_movement_used_cents(${q(ids.tenant)},${q(source.incoming)})::text`),'5000');
 pass('two advances cannot reserve the same incoming movement capacity');

 source=await seed();command=await payload(source);result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(ids.tenant+':finance')},0))`,record(command),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)}`});assert.match(result.error,/finance_access_denied/);assert.equal(await scopedCount('finance_private.driver_advance_returns',source),'0');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(command.request_id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)}`);
 pass('membership revoked while waiting blocks every journal side effect');

 source=await seed({tenant:ids.otherTenant,account:ids.otherAccount,driver:otherDriver});command=await payload(source);await race(`select pg_advisory_xact_lock(hashtextextended(${q(ids.tenant+':finance')},0))`,record(command),{waitForBlocking:false});assert.equal(await scopedCount('finance_private.driver_advance_returns',source),'1');
 pass('a finance lock in one tenant does not block another tenant');

 source=await seed();command=await payload(source);result=await race(`select id from finance_movements where tenant_id=${q(source.tenant)} and id=${q(source.advance)} for update`,record(command),{waitForBlocking:false,waiterSucceeds:false});assert.match(result.error,/40001[\s\S]*finance_driver_advance_return_busy/);assert.equal(await scopedCount('finance_private.driver_advance_returns',source),'0');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(command.request_id)}`),'0');
 pass('row-first source lock fails fast without deadlock or partial journal');

 console.log(`CORE SHA256 ${migrationHash}`);
 return count;
}
