// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createOperationDatabase,operationCandidateSql,operationPayload,recordOperation} from './helpers/operationOutcomeDatabase';
const sql=(file:string)=>readFileSync('docs/qa/'+file,'utf8').replace(/\r\n/g,'\n').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const recovery=sql('OPERATION-OUTCOMES-RECOVERY-2026-08-30.sql');
type Contract={signature:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean};
const expected=JSON.parse(readFileSync('docs/qa/OPERATION-OUTCOMES-LOCAL-CONTRACTS-2026-08-30.json','utf8')) as {candidate:Contract[];predecessor:Contract[]};
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createOperationDatabase());},30000);beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${['loads','load_items','dispatch_trips','dispatch_stops','dispatch_stop_documents','fiscal_documents','proof_of_delivery','dispatch_events','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments'].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from ${t} t)`).join(',')})`)).rows);
async function contracts(list:Contract[]){for(const f of list){expect((await db.query("select md5(replace(pg_get_functiondef($1::regprocedure),E'\\r\\n',E'\\n')) hash,has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",['public.'+f.signature])).rows[0]).toEqual({hash:f.hash,anon:f.anon,authenticated:f.authenticated,service_role:f.service_role});}}
async function refused(statement:string){const before=await state();await db.exec('savepoint guard');await expect(db.exec(statement)).rejects.toThrow(/recovery refused/);await db.exec('rollback to savepoint guard;release savepoint guard');expect(await state()).toBe(before);}
describe('operational outcome guarded recovery',()=>{
 it('matches function bodies and privileges captured from the real local candidate',async()=>{await contracts(expected.candidate);});
 it('restores and reapplies before any use without changing active trips',async()=>{
  const before=await state();await db.exec(recovery);await contracts(expected.predecessor);expect(await state()).toBe(before);
  await db.exec(operationCandidateSql);await contracts(expected.candidate);expect(await state()).toBe(before);
 });
 it('refuses after a document outcome and preserves the proof/history',async()=>{
  await recordOperation(db,await operationPayload(db,stop));const history=(await db.query('select * from delivery_document_outcomes')).rows;
  await refused(recovery);await contracts(expected.candidate);expect((await db.query('select * from delivery_document_outcomes')).rows).toEqual(history);
 });
 it.each([
  ['body',"alter function record_operation_document_outcome(jsonb) set search_path=public"],
  ['grant','grant execute on function record_operation_document_outcome(jsonb) to anon'],
  ['table write','grant update on delivery_document_outcomes to authenticated'],
  ['RLS','alter table delivery_document_outcomes disable row level security'],
  ['policy','alter policy delivery_document_outcomes_operator_read on delivery_document_outcomes using(true)'],
  ['column','alter table delivery_document_outcomes add column qa_drift text'],
  ['not null','alter table delivery_document_outcomes alter column proof_snapshot drop not null'],
  ['trigger','alter table delivery_document_outcomes disable trigger preserve_delivery_document_outcome'],
  ['cache','alter table idempotency_keys disable row level security'],
 ])('refuses %s drift',async(_label,drift)=>{await db.exec(drift);await refused(recovery);});
 it.each(['ITEM-PREPARATION-RECOVERY-2026-08-30.sql','DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql'])('blocks older %s while this layer exists',async(file)=>{await refused(sql(file));await contracts(expected.candidate);});
});
