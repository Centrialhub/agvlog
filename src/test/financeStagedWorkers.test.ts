// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase} from './helpers/financeLedgerDatabase';
const specs=[
 {name:'fiscal',source:'20260910012756_finance_fiscal_queue_worker.sql',rollout:'20260910224741_finance_fiscal_worker_staged.sql',job:'finance-fiscal-projection-every-minute',fn:'finance_private.run_fiscal_queue(integer)',command:"SET statement_timeout = '25s'; SELECT finance_private.run_fiscal_queue(50);"},
 {name:'bank',source:'20260910022059_finance_automatic_reference_reconciliation.sql',rollout:'20260910225047_finance_bank_worker_staged.sql',job:'finance-bank-reconciliation-every-minute',fn:'finance_private.run_automatic_reconciliation_queue()',command:"SET statement_timeout = '25s'; SELECT finance_private.run_automatic_reconciliation_queue();"},
];
const opened:Array<Awaited<ReturnType<typeof createFinanceLedgerDatabase>>>=[];
const read=(name:string)=>readFileSync('supabase/migrations/'+name,'utf8');
async function fixture(name:string){
 const db=await createFinanceLedgerDatabase();opened.push(db);
 if(name==='fiscal')await db.exec('create table finance_fiscal_projection_jobs(observation_id uuid,tenant_id uuid,status text,created_at timestamptz);');
 else {
  await db.exec('alter table bank_accounts add column account_number text,add column bank_code text,add column branch_number text,add column account_type text');
  await db.exec("create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;create function finance_private.can_read_receipt(_path text) returns boolean language sql security definer set search_path='' as $$select finance_private.can_access(split_part(_path,'/',1)::uuid)$$;grant execute on function finance_private.can_read_receipt(text) to authenticated,anon;grant usage on schema finance_private to anon;");
  for(const migration of ['20260909222851_finance_statement_intake.sql','20260909223737_finance_statement_source_verification.sql','20260909230507_finance_statement_queries.sql','20260909231643_finance_statement_identity_review.sql','20260909233625_finance_audit_queries.sql','20260910013543_finance_bank_reconciliation_groups.sql','20260910014238_finance_reconciliation_workspace.sql','20260910015331_finance_reconciliation_history.sql','20260910020543_finance_ofx_statement_intake.sql','20260910021404_finance_native_statement_account.sql'])await db.exec(read(migration));
 }
 await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$");
 await db.exec(`
 create schema cron;
 create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,username text default current_user,database text default current_database(),active boolean default true);
 create function cron.schedule(_name text,_schedule text,_command text) returns bigint language plpgsql as $$declare result bigint;begin insert into cron.job(jobname,schedule,command) values(_name,_schedule,_command) returning jobid into result;return result;end;$$;
 create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language plpgsql as $$begin
 if current_setting('test.pause_failure',true)='true' then raise exception 'simulated_pause_failure';end if;
 if current_setting('test.pause_noop',true)='true' then return;end if; update cron.job set active=alter_job.active where jobid=job_id;end;$$;
 `);
 return db;
}
afterEach(async()=>{for(const db of opened.splice(0))await db.close();});
for(const spec of specs){
 const staged=readFileSync('supabase/rollouts/'+spec.rollout,'utf8');
 it(spec.name+' preserves the full original bytes and schedules then pauses in one atomic statement',async()=>{
  const original=read(spec.source);
  expect(staged.split('$original_worker$')[1]).toBe(original);
  expect(staged).toContain(createHash('sha256').update(readFileSync('supabase/migrations/'+spec.source)).digest('hex'));
  const db=await fixture(spec.name);await db.exec(staged);
  const jobs=(await db.query('select jobname,schedule,command,active from cron.job')).rows;
  expect(jobs).toEqual([{jobname:spec.job,schedule:'* * * * *',command:spec.command,active:false}]);
  expect((await db.query<{present:boolean,callable:boolean}>("select to_regprocedure($1) is not null present,has_function_privilege('service_role',$1,'execute') callable",[spec.fn])).rows[0]).toEqual({present:true,callable:false});
  expect((await db.query<{allowed:boolean}>("select finance_private.can_access(gen_random_uuid()) allowed")).rows[0].allowed).toBe(false);
 });
 it(spec.name+' rolls back worker, scheduling and DDL when pausing fails',async()=>{
  const db=await fixture(spec.name);await db.exec("set test.pause_failure='true'");
  await expect(db.exec(staged)).rejects.toThrow('simulated_pause_failure');
  expect((await db.query('select * from cron.job')).rows).toEqual([]);
  expect((await db.query<{missing:boolean}>('select to_regprocedure($1) is null missing',[spec.fn])).rows[0].missing).toBe(true);
  if(spec.name==='fiscal')expect((await db.query("select 1 from information_schema.columns where table_name='finance_fiscal_projection_jobs' and column_name='available_at'")).rows).toEqual([]);
  else expect((await db.query<{missing:boolean}>("select to_regclass('public.finance_automatic_reconciliation_jobs') is null missing")).rows[0].missing).toBe(true);
 });
 it(spec.name+' refuses a silent no-op pause and rolls back its scheduled job',async()=>{
  const db=await fixture(spec.name);await db.exec("set test.pause_noop='true'");
  await expect(db.exec(staged)).rejects.toThrow('finance_staged_pause_not_confirmed');
  expect((await db.query('select * from cron.job')).rows).toEqual([]);
  expect((await db.query<{missing:boolean}>('select to_regprocedure($1) is null missing',[spec.fn])).rows[0].missing).toBe(true);
 });
 it(spec.name+' refuses missing cron support before applying source',async()=>{
  const db=await fixture(spec.name);await db.exec('drop schema cron cascade');
  await expect(db.exec(staged)).rejects.toThrow('finance_staged_cron_dependency_missing');
  expect((await db.query<{missing:boolean}>('select to_regprocedure($1) is null missing',[spec.fn])).rows[0].missing).toBe(true);
 });
 it(spec.name+' refuses an existing job without modifying it',async()=>{
  const db=await fixture(spec.name);await db.query("select cron.schedule($1,'0 0 * * *','select 42')",[spec.job]);
  await expect(db.exec(staged)).rejects.toThrow('finance_staged_job_already_exists');
  expect((await db.query('select schedule,command,active from cron.job')).rows).toEqual([{schedule:'0 0 * * *',command:'select 42',active:true}]);
 });
}
