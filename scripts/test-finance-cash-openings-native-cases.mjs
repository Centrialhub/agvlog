import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runCashOpeningsNative({query,contested,literal:q,createRoles=false}){
 const database='finance_cash_openings_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'cash';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910140010_finance_account_opening_balances','20260910141240_finance_cash_opening_counts']){
  const sql=readFileSync(`supabase/migrations/${name}.sql`,'utf8');await run('begin;'+sql+'commit;');console.log(name+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`;
 const record=p=>`${auth}select record_finance_cash_opening(${q(JSON.stringify(p))}::jsonb)`;
 async function fixture(){const account=randomUUID();await run(`insert into bank_accounts(id,tenant_id,active) values(${q(account)},${q(i.tenant)},true)`);
  return {account,payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:account,effective_from:'2026-09-01',custodian_name:'Custodiante QA',reason:'Contagem física inicial concorrente',counts:[{denomination_cents:20000,quantity:999999999},{denomination_cents:1,quantity:0}]}};
 }
 async function counts(f,total){assert.equal(await run(`select count(*) from finance_account_openings where bank_account_id=${q(f.account)}`),String(total));assert.equal(await run(`select count(*) from finance_movements where bank_account_id=${q(f.account)}`),'0');}
 const race=(a,b,options={})=>contested(a,b,{database,driver:false,...options});
 const tests=[
 ['same request waits then replays count and creates no money',async()=>{
  const f=await fixture();await race(record(f.payload),record(f.payload));await counts(f,1);
  const saved=JSON.parse(await run(`select result from finance_commands where request_id=${q(f.payload.request_id)}`));assert.equal(saved.balance_cents,'19999999980000');
  assert.equal(await run(`select count(*) from finance_events where entity_id=${q(saved.opening_id)}`),'1');
  const read=JSON.parse(await run(`${auth}select get_finance_account_opening(${q(i.tenant)},${q(f.account)},'2026-09-01','2026-09-30')`));assert.equal(read.opening.evidence_status,'valid');assert.equal(read.opening.evidence.counts[0].quantity,0);assert.equal(read.can_close,false);
 }],
 ['different requests compete for one shared active opening',async()=>{
  const f=await fixture(),second={...f.payload,request_id:randomUUID()};const r=await race(record(f.payload),record(second),{waiterSucceeds:false});assert.match(r.error,/finance_account_opening_exists/);await counts(f,1);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(second.request_id)}`),'0');
 }],
 ['bank command waiting behind cash cannot create another opening',async()=>{
  const f=await fixture();const bank={version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:f.account,from:'2026-09-01',to:'2026-09-30',revision:'none',reason:'Abertura bancária incorreta para caixa'};
  const r=await race(record(f.payload),`${auth}select record_finance_account_opening(${q(JSON.stringify(bank))}::jsonb)`,{waiterSucceeds:false});assert.match(r.error,/finance_cash_opening_requires_count/);await counts(f,1);
 }],
 ['revoked actor fails after real lock wait with no count or command',async()=>{
  const f=await fixture();const r=await race(lock,record(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await counts(f,0);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
 }],
 ['account reclassified while command waits is rejected without fake bank evidence',async()=>{
  const f=await fixture();const r=await race(lock,record(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update bank_accounts set account_type='checking' where id=${q(f.account)}`});assert.match(r.error,/finance_cash_account_required/);await counts(f,0);
 }],
 ['existing reversal allows waiting recount and preserves all evidence',async()=>{
  const f=await fixture(),first=JSON.parse(await run(record(f.payload))),reversal={version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:first.opening_id,reason:'Recontagem auditada preservando discriminação'};
  await race(`${auth}select reverse_finance_account_opening(${q(JSON.stringify(reversal))}::jsonb)`,record({...f.payload,request_id:randomUUID()}));await counts(f,2);
  const read=JSON.parse(await run(`${auth}select get_finance_account_opening(${q(i.tenant)},${q(f.account)},'2026-09-01','2026-09-30')`));assert.equal(read.history.length,2);assert.equal(read.history[1].evidence.custodian_name,'Custodiante QA');assert.equal(read.opening.evidence_type,'cash_count_v1');
 }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
