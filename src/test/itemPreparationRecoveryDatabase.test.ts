// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createItemWriterDatabase,itemWriterCandidateSql,itemWriterIds as i,seedItemWriter} from './helpers/loadItemWriterDatabase';
import {documentChangeCandidateSql} from './helpers/documentChangesDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
import {twoPlannedTrips} from './helpers/replanningDatabase';
const body=(path:string)=>readFileSync(path,'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const recovery=body('docs/qa/ITEM-PREPARATION-RECOVERY-2026-08-30.sql');
const olderRecovery=body('docs/qa/DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql');
type Contract={signature:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean};
const expected=JSON.parse(readFileSync('docs/qa/ITEM-PREPARATION-LOCAL-CONTRACTS-2026-08-30.json','utf8')) as {predecessor:Contract[];candidate:Contract[]};
let db:PGlite;
beforeAll(async()=>{db=await createItemWriterDatabase();},30000);
beforeEach(async()=>{await seedItemWriter(db);await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
 'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
 'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')})`)).rows);
async function contracts(list:Contract[]){for(const f of list){const actual=(await db.query("select md5(replace(pg_get_functiondef($1::regprocedure),E'\\r\\n',E'\\n')) hash,has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",['public.'+f.signature])).rows[0];
 expect(actual).toEqual({hash:f.hash,anon:f.anon,authenticated:f.authenticated,service_role:f.service_role});}}
async function refused(sql:string,pattern:RegExp){const before=await state();await db.exec('savepoint qa_item_recovery');await expect(db.exec(sql)).rejects.toThrow(pattern);
 await db.exec('rollback to savepoint qa_item_recovery;release savepoint qa_item_recovery');expect(await state()).toBe(before);}
async function save(){await compositionRpc(db,'select save_load_item_preparation($1::jsonb)',[JSON.stringify({tenant_id:i.tenant,load_id:i.load,item_id:i.item,values:{status:'loaded'},expected:{status:'pending'},request_id:i.request})]);}
describe('item preparation recovery and migration guards',()=>{
 it('matches the recorded candidate bodies and grants',async()=>{await contracts(expected.candidate);});
 it('restores and reapplies the unused API without touching planned routes',async()=>{
  await twoPlannedTrips(db);const before=await state();await db.exec(recovery);await contracts(expected.predecessor);
  expect((await db.query("select to_regprocedure('public.save_load_item_preparation(jsonb)') api")).rows[0]).toEqual({api:null});
  expect(await state()).toBe(before);await db.exec(itemWriterCandidateSql);await contracts(expected.candidate);expect(await state()).toBe(before);
 });
 it.each([
  ['body','alter function public.save_load_item_preparation(jsonb) set search_path=public'],
  ['grant','grant execute on function public.save_load_item_preparation(jsonb) to anon'],
  ['RLS','alter table public.idempotency_keys disable row level security'],
  ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true)'],
  ['write policy','create policy qa_write on public.idempotency_keys for insert to authenticated with check(true)'],
  ['column',"alter table public.idempotency_keys alter column response_body set default '{}'"],
 ])('refuses %s drift before restoring functions',async(_name,drift)=>{await db.exec(drift);await refused(recovery,/Item preparation recovery refused/);});
 it('refuses after recoverable API use',async()=>{await save();await refused(recovery,/business usage exists/);await contracts(expected.candidate);});
 it('refuses after legacy use even without a request key',async()=>{
  await compositionRpc(db,"select upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_status=>'loaded')",[i.tenant,i.item]);await refused(recovery,/business usage exists/);
 });
 it('refuses remaining audit evidence after response-cache retention',async()=>{
  await save();await db.exec("delete from idempotency_keys where operation='save_load_item_preparation'");await refused(recovery,/business usage exists/);
 });
 it('blocks older document recovery while the new writer is installed',async()=>{
  await refused(olderRecovery,/newer item preparation writer exists/);await contracts(expected.candidate);
 });
 it('restores in reverse order and reapplies both layers without changing business records',async()=>{
  await twoPlannedTrips(db);const before=await state();await db.exec(recovery);await db.exec(olderRecovery);expect(await state()).toBe(before);
  await db.exec(documentChangeCandidateSql);await db.exec(itemWriterCandidateSql);await contracts(expected.candidate);expect(await state()).toBe(before);
 });
 it.each([
  ['RLS','alter table public.idempotency_keys disable row level security'],
  ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true)'],
  ['write policy','create policy qa_write on public.idempotency_keys for insert to authenticated with check(true)'],
  ['column',"alter table public.idempotency_keys alter column response_body set default '{}'"],
 ])('migration refuses %s drift before installing its API',async(_name,drift)=>{
  await db.exec(recovery);await db.exec(drift);await refused(itemWriterCandidateSql,/requires protected response cache/);await contracts(expected.predecessor);
 });
});
