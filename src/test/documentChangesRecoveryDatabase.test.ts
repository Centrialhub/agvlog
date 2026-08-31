// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDocumentChangeDatabase,documentChangeCandidateSql,documentChangeIds as i,seedDocumentChanges,documentChangePayload,changeDocuments} from './helpers/documentChangesDatabase';
import {twoPlannedTrips,replanningCandidateSql} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';

const body=(path:string)=>readFileSync(path,'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const recovery=body('docs/qa/DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql');
const priorRecovery=body('docs/qa/REPLANNING-RECOVERY-2026-08-30.sql');
type Contract={signature:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean};
const contracts=JSON.parse(readFileSync('docs/qa/DOCUMENT-CHANGES-LOCAL-CONTRACTS-2026-08-30.json','utf8')) as {candidate:Contract[];predecessor:Contract[]};
let db:PGlite;
beforeAll(async()=>{db=await createDocumentChangeDatabase();},30000);
beforeEach(async()=>{await seedDocumentChanges(db);await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});
const business=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
 'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
 'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')})`)).rows);
async function assertContracts(expected:Contract[]){
 for(const f of expected){
  const actual=(await db.query("select md5(replace(pg_get_functiondef($1::regprocedure),E'\\r\\n',E'\\n')) hash,has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",['public.'+f.signature])).rows[0];
  expect(actual).toEqual({hash:f.hash,anon:f.anon,authenticated:f.authenticated,service_role:f.service_role});
 }
}
async function refused(sql:string,pattern:RegExp){
 const before=await business();await db.exec('savepoint qa_recovery');
 await expect(db.exec(sql)).rejects.toThrow(pattern);await db.exec('rollback to savepoint qa_recovery;release savepoint qa_recovery');
 expect(await business()).toBe(before);
}

describe('document changes guarded local recovery',()=>{
 it('matches every recorded candidate function and privilege',async()=>{await assertContracts(contracts.candidate);});
 it('restores five predecessors and reapplies before use while retaining planned routes and cache',async()=>{
  await twoPlannedTrips(db);const before=await business();await db.exec(recovery);await assertContracts(contracts.predecessor);
  expect((await db.query("select to_regprocedure('public.change_load_documents(jsonb)') api,to_regprocedure('public.replan_load_items(jsonb)') is not null replanning,exists(select 1 from information_schema.columns where table_schema='public' and table_name='idempotency_keys' and column_name='response_body') cache")).rows[0])
   .toEqual({api:null,replanning:true,cache:true});
  expect(await business()).toBe(before);await db.exec(documentChangeCandidateSql);await assertContracts(contracts.candidate);expect(await business()).toBe(before);
 });
 it.each([
  ['body','alter function public.change_load_documents(jsonb) set search_path=public'],
  ['grant','grant execute on function public.change_load_documents(jsonb) to anon'],
  ['private helper grant','grant execute on function public._lock_load_document_graph(uuid,uuid) to authenticated'],
  ['RLS','alter table public.idempotency_keys disable row level security'],
  ['write policy','create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true)'],
  ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true)'],
 ])('refuses %s drift before changing functions or business evidence',async(_name,drift)=>{
  await db.exec(drift);await refused(recovery,/Document change recovery refused/);
 });
 it('refuses after a committed attachment without erasing its response or audit',async()=>{
  await changeDocuments(db,await documentChangePayload(db,'attach',i.load,[i.doc3]));
  await refused(recovery,/business usage exists/);await assertContracts(contracts.candidate);
 });
 it('refuses after a committed removal even if the source load was deleted',async()=>{
  await changeDocuments(db,{...await documentChangePayload(db,'detach',i.load,[i.doc,i.doc2]),target_stop:null});
  expect((await db.query('select count(*)::int n from loads where id=$1',[i.load])).rows[0]).toEqual({n:0});
  await refused(recovery,/business usage exists/);await assertContracts(contracts.candidate);
 });
 it('refuses audit-only usage when response cache retention has removed the key',async()=>{
  await changeDocuments(db,await documentChangePayload(db,'attach',i.load,[i.doc3]));
  // Disposable fixture only: emulate independent retention, never bypass a live guard.
  await db.exec("delete from idempotency_keys where operation='change_load_documents'");
  await refused(recovery,/business usage exists/);
 });
 it.each(['assign_fiscal_documents_to_load_v2','remove_fiscal_documents_from_load_v2'])('refuses legacy %s usage without a new response key',async(name)=>{
  await compositionRpc(db,`select public.${name}($1,$2,$3)`,[i.tenant,i.load,[name.startsWith('assign')?i.doc3:i.doc]]);
  expect((await db.query("select count(*)::int n from idempotency_keys where operation='change_load_documents'")).rows[0]).toEqual({n:0});
  await refused(recovery,/business usage exists/);await assertContracts(contracts.candidate);
 });
 it('blocks older replanning recovery even before the document API has been used',async()=>{
  await refused(priorRecovery,/newer document composition APIs exist/);await assertContracts(contracts.candidate);
  expect((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='idempotency_keys' and column_name='response_body'")).rows[0]).toEqual({n:1});
 });
 it('allows strictly reverse-order recovery and reapplication before any use',async()=>{
  const before=await business();await db.exec(recovery);await db.exec(priorRecovery);
  expect(await business()).toBe(before);await db.exec(replanningCandidateSql);await db.exec(documentChangeCandidateSql);
  await assertContracts(contracts.candidate);expect(await business()).toBe(before);
 });
 it.each([
  ['RLS','alter table public.idempotency_keys disable row level security'],
  ['write policy','create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true)'],
  ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true)'],
 ])('migration refuses %s drift before adding APIs',async(_name,drift)=>{
  await db.exec(recovery);await db.exec(drift);await refused(documentChangeCandidateSql,/requires protected response cache/);
  await assertContracts(contracts.predecessor);
 });
});
