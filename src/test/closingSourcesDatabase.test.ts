// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {closingSources,closingSourceFilters,createClosingSourcesDatabase,seedClosingCte} from './helpers/closingSourcesDatabase';
import {operationIds as i,operationPayload,recordOperation,operationRpc} from './helpers/operationOutcomeDatabase';
import {seedUndelivered,driverPartial} from './helpers/deliveryAttemptDatabase';
import {requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
import {correctOperation,correctionPayload} from './helpers/operationCorrectionDatabase';
interface Response {revision:string;version:number;complete:boolean;documents:Array<{key:string;attempt_id:string|null;historical:boolean;
 document:{id:string;load_id:string|null;freight_value:number};outcome:{id:string;status:string;occurred_at:string}|null;
 financial_review_required:boolean;volume_count_verified:boolean;physical:{weight_kg:number;quantity:number}}>;fiscal_candidates:Array<{id:string;environment:string|null;kind:string}>;allocation_documents:Array<{document:{id:string}}>}
const read=async(db:PGlite,filters=closingSourceFilters)=>await closingSources(db,filters) as Response;
let db:PGlite;let stop:string;let trip:string;
beforeAll(async()=>{({db,stop,trip}=await createClosingSourcesDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('closing sources / real attempt database',{timeout:15000},()=>{
 it('returns a complete, deterministic, data-minimized source without mutating operational rows',async()=>{
  const before=(await db.query('select to_jsonb(f) row from fiscal_documents f order by id')).rows;
  const first=await read(db);expect(first).toMatchObject({version:1,complete:true});expect(first.documents).toHaveLength(3);
  expect(await read(db)).toEqual(first);expect(first.revision).toMatch(/^[a-f0-9]{32}$/);
  expect(first.documents.every(d=>!('delivery_meta' in d.document)&&!('cte_payload' in d.document))).toBe(true);
  expect((await db.query('select to_jsonb(f) row from fiscal_documents f order by id')).rows).toEqual(before);
 });
 it('reads the audited result, not delivered_at or a technical note status',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  const doc=(await read(db)).documents.find(d=>d.document.id===i.doc)!;
  expect(doc.outcome?.status).toBe('delivered');expect(doc.outcome?.occurred_at).toBeTruthy();
  expect((await closingSources(db,{...closingSourceFilters,only_delivered:true}) as Response).documents.map(d=>d.document.id)).toEqual([i.doc]);
 });
 it('does not call a partial delivery a completed delivery',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:2});
  const value=await closingSources(db,{...closingSourceFilters,only_delivered:true}) as Response;
  expect(value.documents.some(d=>d.document.id===i.doc)).toBe(false);
 });
 it('keeps the original load/result/freight and a separate unallocated redelivery with no inherited result',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const docs=(await read(db)).documents.filter(d=>d.document.id===i.doc);expect(docs).toHaveLength(2);
  expect(docs.find(d=>d.historical)).toMatchObject({attempt_id:null,document:{load_id:i.load,freight_value:80},outcome:{status:'returned'}});
  expect(docs.find(d=>!d.historical)).toMatchObject({document:{load_id:null,freight_value:0},outcome:null,financial_review_required:true,volume_count_verified:false,physical:{weight_kg:12}});
 });
 it('changes the revision and returns only the corrected outcome, without deleting the old evidence',async()=>{
  await seedUndelivered(db,stop);const before=await read(db);await correctOperation(db,await correctionPayload(db,stop));
  const after=await read(db);expect(after.revision).not.toBe(before.revision);
  expect(after.documents.find(d=>d.document.id===i.doc)?.outcome?.status).toBe('not_delivered');
  expect((await db.query<{n:number}>('select count(*)::int n from delivery_document_outcomes where fiscal_document_id=$1',[i.doc])).rows[0].n).toBe(2);
 });
 it('keeps the full CT-e denominator even when a linked invoice is outside the selected period',async()=>{
  await db.query("update fiscal_documents set issue_date='2026-07-01' where id=$1",[i.doc2]);await seedClosingCte(db);
  const value=await read(db);expect(value.documents.some(d=>d.document.id===i.doc2)).toBe(false);
  expect(value.allocation_documents.map(d=>d.document.id).sort()).toEqual([i.doc,i.doc2].sort());
 });
 it('requires the same load AND invoice relation, and excludes foreign tenant CT-es',async()=>{
  await seedClosingCte(db,{load_ids:[i.load2]});await seedClosingCte(db,{id:'ce000000-0000-4000-8000-000000000002',tenant_id:i.otherTenant});
  expect((await read(db)).fiscal_candidates).toEqual([]);
 });
 it('retains homologation as a diagnostic candidate instead of pretending it is production',async()=>{
  await seedClosingCte(db,{sefaz_environment:'homologation'});expect((await read(db)).fiscal_candidates[0].environment).toBe('homologation');
 });
 it('does not link the old CT-e to a new attempt through the reused invoice ID',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));await seedClosingCte(db);
  const value=await read(db);expect(value.fiscal_candidates).toHaveLength(1);
  expect(value.allocation_documents.filter(d=>d.document.id===i.doc)).toHaveLength(1);
  const old=value.documents.find(d=>d.document.id===i.doc&&d.historical)!;
  expect(value.allocation_documents).toContainEqual(old);
 });
 it('retains the explicit outbound fiscal path without inventing its environment or confusing the CT-e table ID',async()=>{
  const outbound='ce000000-0000-4000-8000-000000000009';
  await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,issue_date,load_id,freight_value) values($1,$2,'outbound','authorized','2026-08-01',$3,90)",[outbound,i.tenant,i.load]);
  await db.query('update fiscal_documents set cte_emitted_outbound_id=$2 where id=$1',[i.doc,outbound]);
  expect((await read(db)).fiscal_candidates).toMatchObject([{id:outbound,kind:'outbound_document',environment:null}]);
 });
 it('fails instead of silently truncating the 501st selected source',async()=>{
  await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,issue_date) select gen_random_uuid(),$1,'inbound','confirmed','2026-08-01' from generate_series(1,498)",[i.tenant]);
  await expect(read(db)).rejects.toThrow('closing_sources_refine_filters');
 });
 it('applies vehicle, driver and client filters without exposing unrelated sources',async()=>{
  const source=(await read(db)).documents.find(d=>d.document.id===i.doc)!;
  const value=await closingSources(db,{...closingSourceFilters,vehicle_id:'ce000000-0000-4000-8000-000000000019'}) as Response;
  expect(value.documents).toEqual([]);expect(value.fiscal_candidates).toEqual([]);expect(value.allocation_documents).toEqual([]);
  expect(source.document.load_id).toBe(i.load);
 });
 it('ignores outbound, deleted and duplicate invoices as operational source rows',async()=>{
  await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,issue_date) values(gen_random_uuid(),$1,'outbound','draft','2026-08-01')",[i.tenant]);
  await db.query('update fiscal_documents set is_duplicate=true where id=$1',[i.doc3]);
  expect((await read(db)).documents.map(d=>d.document.id).sort()).toEqual([i.doc,i.doc2].sort());
 });
 it.each([{period_start:'2026-09-01',period_end:'2026-08-01'},{period_start:'infinity',period_end:'2026-08-01'},
  {...closingSourceFilters,date_basis:'delivered_at'},{...closingSourceFilters,only_delivered:'false'},
  {...closingSourceFilters,tenant_id:i.otherTenant}])('rejects malformed or contradictory filters %j',async filters=>{
  await expect(closingSources(db,filters)).rejects.toThrow(/closing_sources_invalid/);
 });
 it('checks tenant, actor and role, including direct helper ACL',async()=>{
  await expect(closingSources(db,closingSourceFilters,i.otherTenant)).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(read(db)).rejects.toThrow('not_authorized');
  await expect(operationRpc(db,'select * from _closing_attempt_document_sources($1)',[i.tenant])).rejects.toThrow('permission denied');
  const acl=(await db.query("select has_function_privilege('anon','get_closing_report_sources(uuid,jsonb)','execute') anonymous,has_function_privilege('service_role','get_closing_report_sources(uuid,jsonb)','execute') service")).rows[0];
  expect(acl).toEqual({anonymous:false,service:false});
 });
});
