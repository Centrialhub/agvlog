// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {buildClosingAttemptPreview,allocateClosingCents} from '@/lib/closingReports/closingAttemptPreview';
import {parseClosingSources,closingSourceFilterSchema} from '@/lib/closingReports/closingSources';
import {closingSources,closingSourceFilters,createClosingSourcesDatabase,seedClosingCte} from './helpers/closingSourcesDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createClosingSourcesDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const filters=closingSourceFilterSchema.parse(closingSourceFilters);
const context={tenantId:i.tenant,actorId:i.operator,filters};
const read=async()=>parseClosingSources(await closingSources(db),context);
describe('attempt-aware preview / frontend projection of real SQL',{timeout:15000},()=>{
 it('separates attempt rows but counts the value of each invoice once',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const preview=buildClosingAttemptPreview(await read());expect(preview.totals).toMatchObject({attempt_count:4,fiscal_document_count:3,total_invoice_value:3000,total_freight_value:240});
  const rows=preview.items.filter(row=>row.fiscal_document_id===i.doc);expect(rows).toHaveLength(2);
  expect(rows.find(row=>row.metadata.historical)).toMatchObject({freight_value:80,delivery_status:'returned',delivery_date:null});
  expect(rows.find(row=>row.metadata.attempt_id)).toMatchObject({freight_value:0,weight_kg:12,volume_count:0,delivery_status:null,metadata:{financial_review_required:true,physical_source:'reserved_attempt'}});
  expect(preview.posting_enabled).toBe(false);
 });
 it('allocates only the selected NF share, not the omitted document share',async()=>{
  await db.query("update fiscal_documents set issue_date='2026-07-01' where id=$1",[i.doc2]);await seedClosingCte(db);
  const preview=buildClosingAttemptPreview(await read(),{allocation:'cte_by_value',onlyWithCte:true});
  expect(preview.items).toHaveLength(1);expect(preview.totals.total_freight_value).toBe(50);
 });
 it.each(['homologation','sandbox','production-unknown',null])('does not use %s fiscal freight as a production charge',async environment=>{
  await seedClosingCte(db,{sefaz_environment:environment});const preview=buildClosingAttemptPreview(await read(),{allocation:'cte_by_value'});
  expect(preview.totals.total_freight_value).toBe(0);expect(preview.financial_review_required).toBe(true);
  expect(buildClosingAttemptPreview(await read(),{onlyWithCte:true}).items).toEqual([]);
 });
 it.each(['cancelled','rejected','draft','processing'])('rejects fiscal status %s despite a stale authorized SEFAZ flag',async status=>{
  await seedClosingCte(db,{status});const preview=buildClosingAttemptPreview(await read(),{allocation:'cte_by_value'});expect(preview.totals.total_freight_value).toBe(0);
 });
 it('reports multiple accepted fiscal candidates instead of letting the last row win',async()=>{
  await seedClosingCte(db);await seedClosingCte(db,{id:'ce000000-0000-4000-8000-000000000002'});
  const preview=buildClosingAttemptPreview(await read(),{allocation:'cte_by_value'});
  expect(preview.totals.total_freight_value).toBe(0);expect(preview.divergences.some(d=>d.code==='ambiguous_cte')).toBe(true);
 });
 it('does not allocate with a missing reference or a zero denominator',async()=>{
  await seedClosingCte(db,{fiscal_document_ids:[i.doc,i.doc2,'ce000000-0000-4000-8000-000000000003']});
  expect(buildClosingAttemptPreview(await read(),{allocation:'cte_by_value'}).totals.total_freight_value).toBe(0);
  expect(allocateClosingCents(100,[{key:'a',weight:0}])).toBeNull();
 });
 it('preserves exact cents with stable largest-remainder tie breaking',()=>{
  expect([...allocateClosingCents(100,[{key:'c',weight:1},{key:'a',weight:1},{key:'b',weight:1}])!]).toEqual([['c',33.33],['a',33.34],['b',33.33]]);
  expect(allocateClosingCents(-1,[{key:'a',weight:1}])).toBeNull();
  expect(allocateClosingCents(100,[{key:'a',weight:1e300}])).toBeNull();
 });
 it('refuses a duplicated attempt allocation instead of charging its invoice freight twice',async()=>{
  const value=await read();value.documents.push({...value.documents[0],key:'other-allocation'});
  expect(()=>buildClosingAttemptPreview(value)).toThrow('mais de uma alocação');
 });
 it('refuses contradictory goods values for the same invoice rather than choosing one silently',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));const value=await read();
  value.documents.find(d=>d.attempt_id)!.document.value=999;expect(()=>buildClosingAttemptPreview(value)).toThrow('valores diferentes');
 });
 it.each(['tenant','actor','filters','complete','duplicate','version'])('fails closed for a mismatched %s response',async mismatch=>{
  const response=await read();if(mismatch==='tenant')response.tenant_id=i.otherTenant;
  if(mismatch==='actor')response.actor_id=i.user;if(mismatch==='filters')response.filters.only_delivered=true;
  const value:Record<string,unknown>={...response};if(mismatch==='complete')value.complete=false;if(mismatch==='version')value.version=2;
  if(mismatch==='duplicate')response.documents.push(response.documents[0]);
  await expect(Promise.resolve().then(()=>parseClosingSources(value,context))).rejects.toThrow();
 });
});
