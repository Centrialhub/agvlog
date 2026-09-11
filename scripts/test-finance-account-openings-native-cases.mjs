import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runAccountOpeningsNative({query,contested,literal:q,createRoles=false}){
 const database='finance_account_openings_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'checking';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910140010_finance_account_opening_balances']){
  const sql=readFileSync(`supabase/migrations/${name}.sql`,'utf8');await run('begin;'+sql+'commit;');console.log(name+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`;
 const record=p=>`${auth}select record_finance_account_opening(${q(JSON.stringify(p))}::jsonb)`;
 const reverse=p=>`${auth}select reverse_finance_account_opening(${q(JSON.stringify(p))}::jsonb)`;
 const stamp=(day,time)=>({date:day,raw:day.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
 async function fixture(){
  const account=randomUUID(),id=randomUUID(),verification=randomUUID(),hash=id.replace(/-/g,'').repeat(2);
  await run(`insert into bank_accounts(id,tenant_id,active,account_number) values(${q(account)},${q(i.tenant)},true,${q(account.replace(/-/g,''))});
   insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by)
   values(${q(id)},${q(i.tenant)},${q(account)},${q(hash)},'path','extrato.ofx','{}','native-ofx-v1','{}','2026-08-01','2026-08-31','BRL',0,${q(i.operator)});`);
  const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:account.replace(/-/g,''),account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:stamp('2026-08-01','000000'),end:stamp('2026-08-31','235959')},ledger_balance:{amount_cents:12345,as_of:stamp('2026-08-31','235959')}}};
  const verificationSql=()=>`insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values(${q(randomUUID())},${q(i.tenant)},${q(id)},${q(i.operator)},'statement-source-v1','revision','rows_match',${q(JSON.stringify(report))}::jsonb)`;
  await run(verificationSql());
  const evidence=JSON.parse(await run(`${auth}select get_finance_statement_period_evidence(${q(i.tenant)},${q(account)},'2026-09-01','2026-09-30')`));
  return {account,verification,payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:account,from:'2026-09-01',to:'2026-09-30',revision:evidence.revision,reason:'Conferência nativa da abertura bancária'},verificationSql};
 }
 async function counts(f,total,active=total){
  assert.equal(await run(`select count(*) from finance_account_openings where bank_account_id=${q(f.account)}`),String(total));
  assert.equal(await run(`select count(*) from finance_account_openings o where bank_account_id=${q(f.account)} and not exists(select 1 from finance_account_opening_reversals r where r.opening_id=o.id)`),String(active));
  assert.equal(await run(`select count(*) from finance_movements where bank_account_id=${q(f.account)}`),'0');
 }
 const race=(a,b,options={})=>contested(a,b,{database,driver:false,...options});
 const tests=[
  ['different requests serialize with exactly one active opening and no failed-command residue',async()=>{
   const f=await fixture(),second={...f.payload,request_id:randomUUID()};const result=await race(record(f.payload),record(second),{waiterSucceeds:false});assert.match(result.error,/finance_account_opening_exists/);await counts(f,1);
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(second.request_id)}`),'0');
  }],
  ['same request waits then replays the original id without a duplicate audit event',async()=>{
   const f=await fixture();const result=await race(record(f.payload),record(f.payload));await counts(f,1);
   const saved=JSON.parse(await run(`select result from finance_commands where request_id=${q(f.payload.request_id)}`));assert.ok(result.output.includes(saved.opening_id));
   assert.equal(await run(`select count(*) from finance_events where entity_id=${q(saved.opening_id)}`),'1');
  }],
  ['reversal first lets a waiting replacement create one active opening and keeps history',async()=>{
   const f=await fixture(),saved=JSON.parse(await run(record(f.payload)));const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),opening_id:saved.opening_id,reason:'Reversão auditada para corrigir abertura'};
   await race(reverse(p),record({...f.payload,request_id:randomUUID()}));await counts(f,2,1);
   assert.equal(await run(`select count(*) from finance_account_opening_reversals where opening_id=${q(saved.opening_id)}`),'1');
  }],
  ['new opening first completes before a waiting reversal and leaves no active opening',async()=>{
   const f=await fixture();
   const reversal=`${auth}select reverse_finance_account_opening(jsonb_build_object('version',1,'tenant_id',${q(i.tenant)},'request_id',${q(randomUUID())},'opening_id',(select id from finance_account_openings where bank_account_id=${q(f.account)}),'reason','Reversão após abertura concorrente'))`;
   // Read the opening ID after acquiring the shared command lock: the row is initially uncommitted.
   await race(record(f.payload),`${identity}${lock};${reversal}`);await counts(f,1,0);
  }],
  ['revoked actor is rejected after the proven advisory wait and leaves no opening',async()=>{
   const f=await fixture();const result=await race(lock,record(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});
   assert.match(result.error,/finance_access_denied/);await counts(f,0);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');
   await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);
  }],
  ['new verification committed before evidence capture invalidates the waiting revision atomically',async()=>{
   const f=await fixture();const result=await race(lock,record(f.payload),{waiterSucceeds:false,holderAfterBlocked:f.verificationSql()});assert.match(result.error,/finance_opening_evidence_changed/);await counts(f,0);
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
