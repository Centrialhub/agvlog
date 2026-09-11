import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runCoverageApprovalsNative({query,contested,literal:q,createRoles=false}){
 const database='finance_coverage_approvals_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'checking';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 create function finance_private.can_read_receipt(text) returns boolean language sql as $$select true$$;`);
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909230507_finance_statement_queries','20260909231643_finance_statement_identity_review','20260909233625_finance_audit_queries','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910130956_finance_statement_period_evidence','20260910142143_finance_statement_coverage_approvals']){
  const sql=readFileSync(`supabase/migrations/${name}.sql`,'utf8');await run('begin;'+sql+'commit;');console.log(name+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }

 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`;
 const approve=p=>`${auth}select record_finance_statement_coverage_approval(${q(JSON.stringify(p))}::jsonb)`;
 const read=account=>`${auth}select get_finance_statement_coverage_review(${q(i.tenant)},${q(account)},'2026-08-01','2026-08-31')`;
 const stamp=(day,time)=>({date:day,raw:day.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
 async function fixture(){
  const account=randomUUID();await run(`insert into bank_accounts(id,tenant_id,active,account_number) values(${q(account)},${q(i.tenant)},true,${q(account)})`);
  let firstImport,verificationSql;
  for(const day of ['2026-07-31','2026-08-31']){
   const id=randomUUID(),hash=id.replace(/-/g,'').repeat(2);firstImport??=id;
   await run(`insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by) values(${q(id)},${q(i.tenant)},${q(account)},${q(hash)},'path','extrato.ofx','{}','native-ofx-v1','{}','2026-08-01','2026-08-31','BRL',0,${q(i.operator)})`);
   const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:account,account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:stamp('2026-08-01','000000'),end:stamp('2026-08-31','235959')},ledger_balance:{amount_cents:10000,as_of:stamp(day,'235959')}}};
   verificationSql=()=>`insert into finance_statement_verifications(tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values(${q(i.tenant)},${q(id)},${q(i.operator)},'statement-source-v1','revision','rows_match',${q(JSON.stringify(report))}::jsonb)`;await run(verificationSql());
  }
  const review=JSON.parse(await run(read(account)));assert.equal(review.can_approve,true);
  return {account,firstImport,verificationSql,payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:account,from:'2026-08-01',to:'2026-08-31',revision:review.revision,reason:'Originais bancários completos conferidos pelo operador',originals_obtained_from_bank:true,complete_period_confirmed:true}};
 }
 async function count(f,total){assert.equal(await run(`select count(*) from finance_statement_coverage_approvals where bank_account_id=${q(f.account)}`),String(total));assert.equal(await run(`select count(*) from finance_movements where bank_account_id=${q(f.account)}`),'0');}
 const race=(a,b,options={})=>contested(a,b,{database,driver:false,...options});
 const tests=[
 ['same request waits and replays one approval without certification',async()=>{const f=await fixture();await race(approve(f.payload),approve(f.payload));await count(f,1);const review=JSON.parse(await run(read(f.account)));assert.equal(review.current,true);assert.equal(review.authenticity_status,'not_attested');assert.equal(review.can_close,false);assert.equal(await run(`select count(*) from finance_events where entity_id=${q(review.approval.id)}`),'1');}],
 ['different requests serialize to one active approval',async()=>{const f=await fixture(),p={...f.payload,request_id:randomUUID()};const r=await race(approve(f.payload),approve(p),{waiterSucceeds:false});assert.match(r.error,/finance_coverage_approval_exists/);await count(f,1);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(p.request_id)}`),'0');}],
 ['revocation during real advisory wait denies approval atomically',async()=>{const f=await fixture();const r=await race(lock,approve(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await count(f,0);await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`);}],
 ['new verification before capture invalidates waiting preview',async()=>{const f=await fixture();const r=await race(lock,approve(f.payload),{waiterSucceeds:false,holderAfterBlocked:f.verificationSql()});assert.match(r.error,/finance_coverage_evidence_changed/);await count(f,0);}],
 ['offsetting new entries before capture invalidate waiting revision despite same net',async()=>{const f=await fixture();const sql=`insert into finance_bank_entries(tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,description,raw) values(${q(i.tenant)},${q(f.account)},${q(f.firstImport)},1,'2026-08-10',500,'BRL','Entrada','{}'),(${q(i.tenant)},${q(f.account)},${q(f.firstImport)},2,'2026-08-10',-500,'BRL','Saída','{}')`;const r=await race(lock,approve(f.payload),{waiterSucceeds:false,holderAfterBlocked:sql});assert.match(r.error,/finance_coverage_evidence_changed/);await count(f,0);}],
 ['reversal commits before new approval preserving both snapshots',async()=>{const f=await fixture(),saved=JSON.parse(await run(approve(f.payload)));const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),approval_id:saved.approval_id,reason:'Refazer revisão preservando decisão anterior'};await race(`${auth}select reverse_finance_statement_coverage_approval(${q(JSON.stringify(p))}::jsonb)`,approve({...f.payload,request_id:randomUUID()}));await count(f,2);const review=JSON.parse(await run(read(f.account)));assert.equal(review.history.length,2);assert.equal(review.current,true);assert.ok(review.history[1].reversal.id);}],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
