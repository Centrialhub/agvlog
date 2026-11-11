// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
const tenant='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const actor='10000000-0000-4000-8000-000000000001',driver='10000000-0000-4000-8000-000000000002';
const receipt='30000000-0000-4000-8000-000000000001',foreignReceipt='30000000-0000-4000-8000-000000000002';
const hash='b'.repeat(64);let db:PGlite;
const result={text:'Recebido em 09/11/2026',date_text:'09/11/2026',delivery_date:'2026-11-09',date_confidence:0.95,
 signature_presence:'present',signature_confidence:0.96,needs_review:false,provider:'lovable',model:'google/gemini-3-flash-preview'};
interface Claim{job_id:string;lease_token:string;processed_hash:string}
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema delivery_private;grant usage on schema auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table memberships(tenant_id uuid,user_id uuid,role text);
 create function public.is_tenant_operator_or_admin(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships where tenant_id=t and user_id=auth.uid() and role in('admin','operator'))$$;
 create table audit(action text);
 create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$insert into public.audit values($4)$$;
 create table public.delivery_receipts(id uuid primary key,tenant_id uuid not null,processed_path text,processed_hash text,is_active boolean default true,
  delivered_at timestamptz default '2026-11-10T15:00:00Z',updated_at timestamptz default now(),unique(tenant_id,id));
 alter table delivery_receipts enable row level security;grant select on delivery_receipts to authenticated;
 create policy operator_read on delivery_receipts for select to authenticated using(public.is_tenant_operator_or_admin(tenant_id));
 insert into memberships values('${tenant}','${actor}','operator'),('${tenant}','${driver}','driver');
 `);
 // Minimal native queue fixture: the real original and incremental SQL execute,
 // with no Storage/provider/network and no operational delivery records.
 await db.exec(readFileSync('supabase/migrations/20260910174335_add_delivery_receipt_ocr_queue.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261110151444_enable_receipt_handwriting_recognition.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261111182259_support_openai_receipt_recognition.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261111182259_support_openai_receipt_recognition.sql','utf8'));
 // Only the verifier's isolated-seed sentinel; does not simulate GoTrue/Auth.
 await db.exec("create table auth.users(email text);insert into auth.users select 'fixture'||g||'@agvlog-e2e.invalid' from generate_series(1,7) g;");
 await db.exec(readFileSync('supabase/verify/openai_receipt_contract.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 await db.query('insert into delivery_receipts(id,tenant_id,processed_path,processed_hash) values($1,$2,$3,$4)',[receipt,tenant,tenant+'/receipt.jpg',hash]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function service<T>(sql:string,args:unknown[]=[],role:'authenticated'|'service_role'|'anon'='service_role'){await db.exec('savepoint service_call;set role '+role);
 try{const value=await db.query<T>(sql,args);await db.exec('reset role;release savepoint service_call');return value;}
 catch(error){await db.exec('rollback to savepoint service_call;release savepoint service_call');throw error;}}
async function claim(){return (await service<{r:Claim}>('select claim_delivery_receipt_ocr_v1() r')).rows[0].r;}
async function complete(c:Claim,value:unknown=result){return (await service<{r:{applied:boolean;replayed:boolean;status:string}}>(
 "select complete_delivery_receipt_ocr_v2($1,$2,$3,'completed',$4::jsonb,null) r",[c.job_id,c.lease_token,c.processed_hash,JSON.stringify(value)])).rows[0].r;}
it('persists extracted date/signature independently of delivery timestamp and repeats idempotently',async()=>{
 const c=await claim();expect(await complete(c)).toMatchObject({applied:true,replayed:false});expect(await complete(c)).toMatchObject({replayed:true});
 expect((await db.query("select ocr_delivery_date::text d,ocr_signature_presence s,ocr_requires_review review,delivered_at='2026-11-10T15:00:00Z'::timestamptz preserved from delivery_receipts where id=$1",[receipt])).rows[0])
  .toEqual({d:'2026-11-09',s:'present',review:false,preserved:true});
 expect((await db.query("select count(*)::int n from audit where action='ocr_completed'")).rows[0]).toEqual({n:1});
 await expect(complete(c,{...result,signature_presence:'absent'})).rejects.toThrow('result_conflict');
});
it('persists OpenAI provenance, preserves delivered_at and replays idempotently',async()=>{
 const c=await claim(),value={...result,provider:'openai',model:'gpt-6-luna'};
 expect(await complete(c,value)).toMatchObject({applied:true,replayed:false});expect(await complete(c,value)).toMatchObject({replayed:true});
 expect((await db.query("select ocr_result->>'provider' provider,delivered_at='2026-11-10T15:00:00Z'::timestamptz preserved from delivery_receipts where id=$1",[receipt])).rows[0]).toEqual({provider:'openai',preserved:true});
 await expect(complete(c,result)).rejects.toThrow('result_conflict');
});
it('rejects unknown/null providers and preserves the service-only completion ACL',async()=>{
 const c=await claim();for(const provider of ['unknown',null])await expect(complete(c,{...result,provider})).rejects.toThrow('invalid_delivery_receipt_ocr_result');
 await expect(service("select complete_delivery_receipt_ocr_v2($1,$2,$3,'completed',$4::jsonb,null)",[c.job_id,c.lease_token,c.processed_hash,JSON.stringify({...result,provider:'openai'})],'authenticated')).rejects.toThrow('permission denied');
});
it('rejects date without written evidence and malformed signatures before changing the receipt',async()=>{
 const c=await claim();await expect(complete(c,{...result,date_text:'09/11'})).rejects.toThrow('date_without_evidence');
 await expect(complete(c,{...result,signature_presence:null})).rejects.toThrow('invalid_delivery_receipt_ocr_result');
 await expect(complete(c,{...result,delivery_date:'2026-02-31',date_text:'31/02/2026'})).rejects.toThrow();
 expect((await db.query('select ocr_result from delivery_receipts where id=$1',[receipt])).rows[0]).toEqual({ocr_result:null});
});
it('forces review when a service result tries to hide uncertainty',async()=>{
 const c=await claim();await complete(c,{...result,signature_presence:'uncertain',signature_confidence:0.1,needs_review:false});
 expect((await db.query('select ocr_requires_review from delivery_receipts where id=$1',[receipt])).rows[0]).toEqual({ocr_requires_review:true});
});
it('allows illegible writing to remain unknown without guessing a date or signature',async()=>{
 const c=await claim();await complete(c,{...result,text:'',date_text:null,delivery_date:null,date_confidence:0,signature_presence:'uncertain',signature_confidence:0,needs_review:true});
 expect((await db.query('select ocr_delivery_date,ocr_requires_review from delivery_receipts where id=$1',[receipt])).rows[0])
  .toEqual({ocr_delivery_date:null,ocr_requires_review:true});
});
it('stale hash or expired lease cannot attach recognition to a replacement image',async()=>{
 const c=await claim();await db.query("update delivery_receipts set processed_hash=$1,processed_path=$2 where id=$3",['c'.repeat(64),tenant+'/new.jpg',receipt]);
 expect(await complete(c)).toMatchObject({applied:false,status:'superseded'});
 expect((await db.query('select ocr_result from delivery_receipts where id=$1',[receipt])).rows[0]).toEqual({ocr_result:null});
 const next=await claim();await db.query("update delivery_receipt_ocr_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[next.job_id]);
 await expect(complete(next)).rejects.toThrow('lease_invalid');
});
it('backs off failures instead of burning retries in the same worker request',async()=>{
 const c=await claim();await service("select complete_delivery_receipt_ocr_v2($1,$2,$3,'failed',null,'ocr_provider_rate_limited')",[c.job_id,c.lease_token,c.processed_hash]);
 expect((await service<{r:{status:string}}>('select claim_delivery_receipt_ocr_v1() r')).rows[0].r.status).toBe('empty');
 expect((await db.query('select available_at>clock_timestamp() delayed from delivery_receipt_ocr_jobs where id=$1',[c.job_id])).rows[0]).toEqual({delayed:true});
});
it('operator reads only their company; drivers, anon and browser writers are denied',async()=>{
 await complete(await claim());await db.query('insert into delivery_receipts(id,tenant_id,processed_path,processed_hash) values($1,$2,$3,$4)',[foreignReceipt,other,other+'/other.jpg',hash]);
 const read=await service<{r:{rows:Array<{receipt_id:string}>}}>('select get_delivery_receipt_ocr_readings_v1($1,$2) r',[tenant,[receipt,foreignReceipt]],'authenticated');
 expect(read.rows[0].r.rows.map(r=>r.receipt_id)).toEqual([receipt]);
 await expect(service('select get_delivery_receipt_ocr_readings_v1($1,$2)',[other,[foreignReceipt]],'authenticated')).rejects.toThrow('not_authorized');
 await expect(service('select get_delivery_receipt_ocr_readings_v1($1,$2)',[tenant,[receipt]],'anon')).rejects.toThrow('permission denied');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[driver]);
 await expect(service('select get_delivery_receipt_ocr_readings_v1($1,$2)',[tenant,[receipt]],'authenticated')).rejects.toThrow('not_authorized');
 // Failure is contained by a savepoint to keep role checks in a usable transaction.
});
it('role grants and disabled scheduling preserve private queues and secrets',async()=>{
 expect((await db.query("select has_function_privilege('authenticated','complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)','execute') browser_write,has_function_privilege('anon','get_delivery_receipt_ocr_readings_v1(uuid,uuid[])','execute') anonymous_read,has_table_privilege('service_role','delivery_receipt_ocr_jobs','select') queue_read")).rows[0])
  .toEqual({browser_write:false,anonymous_read:false,queue_read:false});
 expect((await db.query('select delivery_private.dispatch_receipt_ocr_tick_v1() id')).rows[0]).toEqual({id:null});
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[driver]);
 await expect(db.query('select get_delivery_receipt_ocr_readings_v1($1,$2)',[tenant,[receipt]])).rejects.toThrow('not_authorized');
});
