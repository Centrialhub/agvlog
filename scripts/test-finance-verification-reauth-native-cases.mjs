import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runVerificationReauthorizationNative({query,contested,literal:q,createRoles=false}){
 const database='finance_verification_reauth_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification'])await run('begin;'+readFileSync(`supabase/migrations/${name}.sql`,'utf8')+'commit;');
 const catalog=`select jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig) order by p.oid) from pg_proc p where p.oid in('finance_private.record_statement_verification(jsonb)'::regprocedure,'public.record_finance_statement_verification(jsonb)'::regprocedure)`;
 const original=await run(catalog),migration=readFileSync('supabase/migrations/20260910142923_finance_statement_verification_reauthorization.sql','utf8');await run('begin;'+migration+'commit;');assert.equal(await run(catalog),original);console.log('PATCH SHA256 '+createHash('sha256').update(migration).digest('hex'));
 const worker=p=>`set role service_role;select record_finance_statement_verification(${q(JSON.stringify(p))}::jsonb)`;
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`;
 async function fixture(){
  const id=randomUUID(),hash=id.replace(/-/g,'').repeat(2);
  await run(`insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by) values(${q(id)},${q(i.tenant)},${q(i.account)},${q(hash)},'path','extrato.csv','{}','csv-v1','{}','2026-08-01','2026-08-31','BRL',1,${q(i.operator)});
  insert into finance_statement_rows(tenant_id,import_id,source_row,raw,classification) values(${q(i.tenant)},${q(id)},1,'{"posted_on":"2026-08-01","amount_cents":100}','new')`);
  const revision=await run(`select md5(finance_private.statement_snapshot(${q(i.tenant)},${q(id)})::text)`);
  return {id,payload:{tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:id,reader_version:'statement-source-v1',source_revision:revision,file_hash:hash,outcome:'rows_match',report:{hash_verified:true,matched_rows:1}}};
 }
 async function counts(f,total){
  assert.equal(await run(`select count(*) from finance_statement_verifications where import_id=${q(f.id)}`),String(total));
  assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),String(total));
  assert.equal(await run(`select count(*) from finance_events where entity_id=${q(f.id)}`),String(total));
 }
 const race=(a,b,options={})=>contested(a,b,{database,driver:false,...options});
 const tests=[
 ['authorized service worker waits then records the real verification exactly once',async()=>{const f=await fixture();await race(lock,worker(f.payload));await counts(f,1);const first=await run(worker(f.payload));assert.equal(await run(worker(f.payload)),first);await counts(f,1);}],
 ['membership revoked while waiting blocks service publication with no residue',async()=>{const f=await fixture();const r=await race(lock,worker(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await counts(f,0);await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);}],
 ['driver membership added while waiting blocks a mixed profile',async()=>{const f=await fixture();const r=await race(lock,worker(f.payload),{waiterSucceeds:false,holderAfterBlocked:`insert into tenant_memberships values(${q(i.tenant)},${q(i.operator)},'driver',true)`});assert.match(r.error,/finance_access_denied/);await counts(f,0);await run(`delete from tenant_memberships where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)} and role='driver'`);}],
 ['active driver record added while waiting blocks even without driver membership',async()=>{const f=await fixture(),driver=randomUUID();const r=await race(lock,worker(f.payload),{waiterSucceeds:false,holderAfterBlocked:`insert into drivers values(${q(driver)},${q(i.tenant)},${q(i.operator)},true)`});assert.match(r.error,/finance_access_denied/);await counts(f,0);await run(`delete from drivers where id=${q(driver)}`);}],
 ['replay also reauthorizes after wait and does not republish or return success to revoked actor',async()=>{const f=await fixture();await run(worker(f.payload));const r=await race(lock,worker(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await counts(f,1);await assert.rejects(()=>run(worker(f.payload)),/finance_access_denied/);await counts(f,1);await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);}],
 ['OID and service-only ACL are preserved and browser cannot publish',async()=>{assert.equal(await run(catalog),original);for(const fn of ['public.record_finance_statement_verification(jsonb)','finance_private.record_statement_verification(jsonb)']){assert.equal(await run(`select has_function_privilege('service_role',${q(fn)},'execute')`),'t');for(const role of ['anon','authenticated'])assert.equal(await run(`select has_function_privilege(${q(role)},${q(fn)},'execute')`),'f');}const f=await fixture();await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;select record_finance_statement_verification(${q(JSON.stringify(f.payload))}::jsonb)`),/permission denied/);await counts(f,0);}],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
