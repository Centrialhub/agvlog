// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseCreationDatabase,creationPayload,creationCommand} from './helpers/expenseCreationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
const signature='public._expense_receipt_status(uuid,uuid,uuid,text,uuid,jsonb)';
const migration=readFileSync('supabase/migrations/20261014141521_remove_required_malware_scan_preserve_receipt_provenance.sql','utf8');
const stamp={scanned:false,scan_status:'not_performed',scan_policy:'patch2-no-scanner-v1'};
let db:PGlite,trip:string,oldDefinition:string;
const fnSnapshot=async()=> (await db.query<{result:unknown}>(`select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'volatility',provolatile,'config',proconfig,'parallel',proparallel,'leakproof',proleakproof) result from pg_proc where oid=$1::regprocedure`,[signature])).rows[0].result;
const policySnapshot=async()=> (await db.query<{result:unknown}>("select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) result from pg_policy where polrelid='storage.objects'::regclass")).rows[0].result;
beforeAll(async()=>{
 ({db,trip}=await createExpenseCreationDatabase());
 oldDefinition=(await db.query<{definition:string}>('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
 const fn=await fnSnapshot(),policies=await policySnapshot();await db.exec(migration);
 expect(await fnSnapshot()).toEqual(fn);expect(await policySnapshot()).toEqual(policies);
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);});afterEach(async()=>{await db.exec('rollback');});
async function draft(){const p=await creationPayload(db,trip);return {...p,receipt:{sha256:'a'.repeat(64),mime:'application/pdf',size:12},fields:{...p.fields,no_receipt:false,no_receipt_reason:null}};}
async function inspect(p:Awaited<ReturnType<typeof draft>>){return (await db.query<{result:{path:string;metadata:Record<string,unknown>;uploaded:boolean}}>('select public._expense_receipt_status($1,$2,$3,$4,$5,$6::jsonb) result',[p.tenant_id,p.actor_id,p.request_id,p.source_type,p.source_id,JSON.stringify(p.receipt)])).rows[0].result;}
async function store(p:Awaited<ReturnType<typeof draft>>,extra:Record<string,unknown>={}){const s=await inspect(p);await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[s.path,JSON.stringify({...s.metadata,...extra})]);return s;}
describe('real receipt SQL preserves honest scan provenance without widening access',()=>{
 it('returns an unscanned template for an absent object and creates no expense or Storage row on install',async()=>{
  const p=await draft(),s=await inspect(p);expect(s.uploaded).toBe(false);expect(s.metadata).toMatchObject(stamp);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(0);
  expect((await db.query<{n:number}>('select count(*)::int n from storage.objects')).rows[0].n).toBe(0);
 });
 it('confirms a canonical unscanned object and replays the same creation without duplicate expense',async()=>{
  const p=await draft();await store(p);expect((await inspect(p)).metadata).toMatchObject(stamp);
  const first=await creationCommand(db,p);expect(first.confirmed).toBe(true);expect(await creationCommand(db,p)).toEqual(first);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(1);
 });
 it('retains actual legacy scanned:true metadata and permits its existing replay',async()=>{
  const p=await draft(),s=await inspect(p);const legacy={...s.metadata,scanned:true};delete (legacy as Record<string,unknown>).scan_status;delete (legacy as Record<string,unknown>).scan_policy;
  await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[s.path,JSON.stringify(legacy)]);
  expect((await inspect(p)).metadata).toEqual(legacy);expect((await creationCommand(db,p)).confirmed).toBe(true);
  expect((await db.query<{metadata:unknown}>('select user_metadata metadata from storage.objects where name=$1',[s.path])).rows[0].metadata).toEqual(legacy);
 });
 it.each([{scanned:null},{scanned:'false'},{scanned:'true'},{scanned:0},{scanned:true},{scanned:false,scan_policy:'client-forged'},
  {scan_status:'clean'},{actor_id:'ec100000-0000-4000-8000-000000000099'},{tenant_id:'ec100000-0000-4000-8000-000000000099'},
  {sha256:'b'.repeat(64)},{size:11},{mime:'image/png'},{source_id:'ec100000-0000-4000-8000-000000000099'}])('rejects forged/inconsistent persisted metadata %j before expense ACK',async change=>{
  const p=await draft();await store(p,change);await db.exec('savepoint failure');
  await expect(creationCommand(db,p)).rejects.toThrow(/expense_receipt_existing_object_mismatch/);await db.exec('rollback to savepoint failure');
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(0);
 });
 it('does not permit the browser actor to forge the service-written stamp through Storage SQL/RLS',async()=>{
  const p=await draft(),s=await inspect(p);
  await expect(operationRpc(db,"insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[s.path,JSON.stringify(s.metadata)])).rejects.toThrow();
 });
 it('keeps the helper inaccessible to authenticated callers',async()=>{
  await expect(operationRpc(db,'select public._expense_receipt_status($1,$2,$3,$4,$5,$6::jsonb)',[i.tenant,i.user,'ec100000-0000-4000-8000-000000000099','trip',trip,'{}'])).rejects.toThrow(/permission denied/);
 });
 it('refuses a changed predecessor ACL and leaves its definition intact after failed DDL',async()=>{
  await db.exec(oldDefinition);await db.exec('grant execute on function '+signature+' to authenticated');await db.exec('savepoint mismatch');
  await expect(db.exec(migration)).rejects.toThrow(/receipt_scan_policy_predecessor_mismatch/);await db.exec('rollback to savepoint mismatch');
  expect((await db.query<{definition:string}>('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition).toContain("'scanned',true");
 });
 it('new full-MFA containment refuses this older fixture instead of restoring a legacy grant',async()=>{
  const recipe=readFileSync('docs/qa/EXPENSE-CREATION-CONTAIN-2026-10-14.sql','utf8').replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\s*$/m,'');
  await expect(db.exec(recipe)).rejects.toThrow(/current MFA function or grants changed/);
 });
 it('runs the exact read-only catalog assertion and rejects a tampered body',async()=>{
  const contract=readFileSync('supabase/verify/baseline_contract.sql','utf8').match(/DO \$verify_unscanned_receipt_policy\$[^]*?\$verify_unscanned_receipt_policy\$;/)?.[0];if(!contract)throw Error('Missing exact catalog contract');
  await db.exec(contract);await db.exec(oldDefinition);await expect(db.exec(contract)).rejects.toThrow(/provenance contract differs/);
 });
});
