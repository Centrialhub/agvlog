// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createClosingDraftDatabase,closingDraftPayload,createClosingDraft} from './helpers/closingDraftDatabase';
import {closingSources,closingSourceFilters,seedClosingCte} from './helpers/closingSourcesDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {seedUndelivered,ownerStatement} from './helpers/deliveryAttemptDatabase';
import {redeliveryPayload,requestRedelivery} from './helpers/redeliveryDatabase';
import {parseClosingSources,closingSourceFilterSchema} from '@/lib/closingReports/closingSources';
import {buildClosingAttemptPreview} from '@/lib/closingReports/closingAttemptPreview';
import {closingTripFieldsSchema} from '@/lib/closingReports/closingTrip';
import {closingExportTotals} from '@/lib/closingReports/closingExport';
import {buildWorkbook} from '@/lib/closingReports/closingReportExcel';
import {buildDetailedCsv,buildSummaryCsv} from '@/lib/closingReports/closingReportCsv';
import * as XLSX from 'xlsx';
import type {BuiltItem,SummaryLine} from '@/lib/closingReports/closingReportBuilder';
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createClosingDraftDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const counts=async()=> (await db.query<{reports:number;items:number;summary:number;history:number;requests:number}>(`select (select count(*)::int from closing_reports) reports,
 (select count(*)::int from closing_report_items) items,(select count(*)::int from closing_report_summary_lines) summary,
 (select count(*)::int from closing_report_history) history,(select count(*)::int from closing_report_creation_requests) requests`)).rows[0];
describe('atomic closing drafts / real PostgreSQL fixture',{timeout:15000},()=>{
 it('creates header, items, summaries, audit and durable acknowledgement together',async()=>{
  const result=await createClosingDraft(db,await closingDraftPayload(db));expect(result).toMatchObject({item_count:3,report:{status:'draft'},totals:{total_freight_value:240,total_invoice_value:3000}});
  expect(await counts()).toEqual({reports:1,items:3,summary:2,history:1,requests:1});
 });
 it('rolls back even the report number when the final audit insert fails',async()=>{
  await db.exec("create function qa_fail_closing_audit() returns trigger language plpgsql as $$begin raise exception 'QA audit failure';end;$$;create trigger qa_fail_closing_audit before insert on closing_report_history for each row execute function qa_fail_closing_audit();");
  await expect(createClosingDraft(db,await closingDraftPayload(db))).rejects.toThrow('QA audit failure');
  expect(await counts()).toEqual({reports:0,items:0,summary:0,history:0,requests:0});
  expect((await db.query('select * from closing_report_sequences')).rows).toEqual([]);
 });
 it('replays the original acknowledgement after the note changes and does not create another report',async()=>{
  const payload=await closingDraftPayload(db);const first=await createClosingDraft(db,payload);
  await db.query("update fiscal_documents set freight_value=95 where id=$1",[i.doc]);expect(await createClosingDraft(db,payload)).toEqual(first);
  expect((await counts()).reports).toBe(1);expect((await counts()).history).toBe(1);
 });
 it('rejects a changed request body under the same durable key',async()=>{
  const payload=await closingDraftPayload(db);await createClosingDraft(db,payload);
  await expect(createClosingDraft(db,{...payload,reason:'Outro motivo conferido'})).rejects.toThrow('key_mismatch');
 });
 it('rejects a stale preview without leaving a partial header or acknowledgement',async()=>{
  const payload=await closingDraftPayload(db);await db.query('update fiscal_documents set freight_value=95 where id=$1',[i.doc]);
  await expect(createClosingDraft(db,payload)).rejects.toThrow('source_changed');expect((await counts()).reports).toBe(0);
 });
 it('does not trust client totals, items or a header for a different selection',async()=>{
  const payload=await closingDraftPayload(db);await expect(createClosingDraft(db,{...payload,items:[{freight_value:1}],total_amount:1})).rejects.toThrow('invalid_request');
  await expect(createClosingDraft(db,{...payload,header:{...payload.header,period_start:'2026-08-02'}})).rejects.toThrow('filter_mismatch');expect((await counts()).reports).toBe(0);
 });
 it.each(['per_nf','cte_by_value','cte_by_weight','first_nf_only'] as const)('matches the frontend projection for %s from authoritative source rows',async allocation=>{
  await seedClosingCte(db);const raw=await closingSources(db);const sources=parseClosingSources(raw,{tenantId:i.tenant,actorId:i.operator,filters:closingSourceFilterSchema.parse(closingSourceFilters)});
  const expected=buildClosingAttemptPreview(sources,{allocation});
  const actual=(await db.query<{items:unknown}>('select _project_closing_source_items($1::jsonb,$2::jsonb) items',[JSON.stringify(raw),JSON.stringify({allocation,only_with_cte:false})])).rows[0].items;
  expect(actual).toEqual(expected.items);
 });
 it('persists both attempts and their source trace without charging the old freight again',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));const result=await createClosingDraft(db,await closingDraftPayload(db));
  expect(result.totals).toMatchObject({attempt_count:4,fiscal_document_count:3,total_invoice_value:3000,total_freight_value:240});
  expect((await db.query("select freight_value::float value,metadata->>'physical_source' physical from closing_report_items where metadata->>'attempt_id' is not null")).rows[0]).toEqual({value:0,physical:'reserved_attempt'});
 });
 it('imports summary-only reports without losing the imported totals or inventing fiscal links',async()=>{
  const base=await closingDraftPayload(db);const {system,...payload}=base;expect(system).toBeTruthy();
  const result=await createClosingDraft(db,{...payload,mode:'spreadsheet',header:{...payload.header,report_model:'summary'},import:{model:'summary',file_name:'qa.xlsx',rows:[{arrival_date:'2026-08-01',billing_period:'primeira quinzena',invoice_value:1234.56,weight_kg:42}]}});
  expect(result).toMatchObject({item_count:0,summary_count:1,totals:{total_invoice_value:1234.56,total_weight_kg:42,total_freight_value:0,fiscal_document_count:0}});
  expect((await counts()).history).toBe(1);
 });
 it('keeps acknowledgement immutable and prevents another tenant or driver from creating/replaying',async()=>{
  const payload=await closingDraftPayload(db);await createClosingDraft(db,payload);
  await expect(ownerStatement(db,"update closing_report_creation_requests set payload_hash='forged'")).rejects.toThrow('append-only');
  await expect(createClosingDraft(db,{...payload,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await expect(createClosingDraft(db,payload)).rejects.toThrow('not_authorized');
  expect((await operationRpc(db,'select * from closing_report_creation_requests')).rows).toEqual([]);
 });
 it('rejects an actor mismatch before writing anything',async()=>{
  await expect(createClosingDraft(db,{...await closingDraftPayload(db),actor_id:i.user})).rejects.toThrow('not_authorized');expect((await counts()).reports).toBe(0);
 });
 it('denies browser DML and private helpers, but permits the explicit writer',async()=>{
  for(const table of ['closing_reports','closing_report_items','closing_report_summary_lines','closing_report_history','closing_report_payments','closing_report_sequences','closing_report_creation_requests']){
   const row=(await db.query<{read:boolean;write:boolean}>("select has_table_privilege('authenticated',$1,'SELECT') read,has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') write",[table])).rows[0];
   expect(row).toEqual({read:true,write:false});
  }
  expect((await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like '\\_closing\\_%' or proname in('_lock_closing_sources','_assert_closing_sources_current','_guard_closing_source_snapshot','_preserve_closing_creation')) and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))")).rows).toEqual([]);
  await createClosingDraft(db,await closingDraftPayload(db));await expect(operationRpc(db,'update closing_reports set title=$1',['forged'])).rejects.toThrow('permission denied');
 });
 it('rolls back header, source items and numbering when the acknowledgement insert fails',async()=>{
  await db.exec("create function qa_fail_closing_ack() returns trigger language plpgsql as $$begin raise exception 'QA ack failure';end;$$;create trigger qa_fail_closing_ack before insert on closing_report_creation_requests for each row execute function qa_fail_closing_ack();");
  await expect(createClosingDraft(db,await closingDraftPayload(db))).rejects.toThrow('QA ack failure');expect(await counts()).toEqual({reports:0,items:0,summary:0,history:0,requests:0});
 });
 it('rechecks financial sources before closing a draft',async()=>{
  const result=await createClosingDraft(db,await closingDraftPayload(db));await db.query('update fiscal_documents set freight_value=999 where id=$1',[i.doc]);
  await expect(operationRpc(db,'select close_closing_report($1)',[result.report.id])).rejects.toThrow('source_changed_requires_review');
  expect((await db.query('select status from closing_reports where id=$1',[result.report.id])).rows[0]).toEqual({status:'draft'});
 });
 it('prevents financial posting when the draft contains a new unpriced attempt',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));const result=await createClosingDraft(db,await closingDraftPayload(db));
  await expect(operationRpc(db,'select close_closing_report($1)',[result.report.id])).rejects.toThrow('financial_review_required');
 });
 it('keeps summary imports explicitly unverified and blocks closing them',async()=>{
  const {system,...base}=await closingDraftPayload(db);expect(system).toBeTruthy();
  const payload={...base,mode:'spreadsheet',header:{...base.header,report_model:'summary'},import:{model:'summary',file_name:'resumo.xlsx',rows:[{arrival_date:null,billing_period:'Agosto',invoice_value:500,weight_kg:20}]}};
  const result=await createClosingDraft(db,payload);await expect(operationRpc(db,'select close_closing_report($1)',[result.report.id])).rejects.toThrow('no_items');
  await expect(ownerStatement(db,`update closing_reports set status='closed' where id='${result.report.id}'`)).rejects.toThrow('financial_review_required');
  expect((await db.query("select filters_snapshot->>'operationally_verified' verified from closing_reports where id=$1",[result.report.id])).rows[0]).toEqual({verified:'false'});
 });
 it.each([-1,'NaN','Infinity'])('rejects an invalid imported value %s without a partial report',async value=>{
  const {system,...base}=await closingDraftPayload(db);expect(system).toBeTruthy();
  await expect(createClosingDraft(db,{...base,mode:'spreadsheet',header:{...base.header,report_model:'summary'},import:{model:'summary',file_name:'bad.xlsx',rows:[{arrival_date:null,billing_period:'Agosto',invoice_value:value,weight_kg:20}]}})).rejects.toThrow('invalid_import');expect((await counts()).reports).toBe(0);
 });
 it('updates shared trip annotations atomically, calculates from merged values, and retries as a no-op',async()=>{
  const report=await createClosingDraft(db,await closingDraftPayload(db));const item=(await db.query<{id:string}>('select * from closing_report_items where load_id=$1 order by id',[i.load])).rows[0];
  const expected=closingTripFieldsSchema.parse(item);const patch={km_initial:100,km_final:200,fuel_liters:10,fuel_unit_price:5};
  const edit=async(before:unknown,change:unknown)=>(await operationRpc(db,'select update_closing_report_trip_fields($1,$2,$3,$4::jsonb,$5::jsonb) result',[i.tenant,report.report.id,item.id,JSON.stringify(before),JSON.stringify(change)])).rows[0].result as {fields:unknown};
  const ack=await edit(expected,patch);await edit(expected,patch);
  expect((await db.query("select count(*)::int n from closing_report_history where action='trip_fields_updated'")).rows[0]).toEqual({n:1});
  await edit(closingTripFieldsSchema.parse(ack.fields),{fuel_liters:20});
  expect((await db.query('select total_km_driven::float km,total_liters::float liters,total_fuel_cost::float fuel,avg_consumption_km_l::float consumption from closing_reports where id=$1',[report.report.id])).rows[0]).toEqual({km:100,liters:20,fuel:100,consumption:5});
  await expect(edit(expected,{fuel_liters:30})).rejects.toThrow('context_changed');
 });
 it('rejects nonfinite trip fields and changes to operational identity',async()=>{
  const report=await createClosingDraft(db,await closingDraftPayload(db));const item=(await db.query<{id:string}>('select * from closing_report_items order by id limit 1')).rows[0];const expected=closingTripFieldsSchema.parse(item);
  const edit=(patch:unknown)=>operationRpc(db,'select update_closing_report_trip_fields($1,$2,$3,$4::jsonb,$5::jsonb)',[i.tenant,report.report.id,item.id,JSON.stringify(expected),JSON.stringify(patch)]);
  await expect(edit({fuel_liters:'NaN'})).rejects.toThrow('invalid_trip_number');await expect(edit({vehicle_plate:'FORGED'})).rejects.toThrow('readonly');
 });
 it('does not silently overwrite conflicting annotations elsewhere in a load group',async()=>{
  const report=await createClosingDraft(db,await closingDraftPayload(db));const items=(await db.query<{id:string}>('select * from closing_report_items where load_id=$1 order by id',[i.load])).rows;
  expect(items.length).toBeGreaterThan(1);await db.query('update closing_report_items set km_initial=1 where id=$1',[items[1].id]);
  await expect(operationRpc(db,'select update_closing_report_trip_fields($1,$2,$3,$4::jsonb,$5::jsonb)',[i.tenant,report.report.id,items[0].id,JSON.stringify(closingTripFieldsSchema.parse(items[0])),JSON.stringify({km_initial:2})])).rejects.toThrow('group_requires_review');
 });
 it('closes an unchanged eligible draft and marks it sent without creating a receivable',async()=>{
  const result=await createClosingDraft(db,await closingDraftPayload(db));await operationRpc(db,'select close_closing_report($1)',[result.report.id]);
  await operationRpc(db,'select mark_closing_report_sent($1,$2,$3,$4)',[i.tenant,result.report.id,'financeiro','manual']);
  await operationRpc(db,'select mark_closing_report_sent($1,$2,$3,$4)',[i.tenant,result.report.id,'financeiro','manual']);
  expect((await db.query('select status,receivable_id,client_invoice_id from closing_reports where id=$1',[result.report.id])).rows[0]).toEqual({status:'sent',receivable_id:null,client_invoice_id:null});
  expect((await db.query("select count(*)::int n from closing_report_history where action='marked_sent'")).rows[0]).toEqual({n:1});
 });
 it('requires review when the selected CT-e already has a receivable',async()=>{
  await seedClosingCte(db);await db.exec("update cte_documents set receivable_id='cc000000-0000-4000-8000-000000000001'");
  const raw=await closingSources(db);const expected=buildClosingAttemptPreview(parseClosingSources(raw,{tenantId:i.tenant,actorId:i.operator,filters:closingSourceFilterSchema.parse(closingSourceFilters)}));
  expect(expected.financial_review_required).toBe(true);const result=await createClosingDraft(db,await closingDraftPayload(db));
  await expect(operationRpc(db,'select close_closing_report($1)',[result.report.id])).rejects.toThrow('financial_review_required');
 });
 it('exports repeated attempts with distinct-note totals and their audit trace',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));const report=await createClosingDraft(db,await closingDraftPayload(db));
  const items=(await db.query<{items:BuiltItem[]}>('select jsonb_agg(to_jsonb(item) order by sort_order) items from closing_report_items item where closing_report_id=$1',[report.report.id])).rows[0].items;
  expect(closingExportTotals(items)).toMatchObject({value:3000,freight:240,notes:3,attempts:4});
  const wb=buildWorkbook({title:'QA',periodStart:'2026-08-01',periodEnd:'2026-08-31',items});
  const rows=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Resumo,{header:1});expect(rows).toContainEqual(['Valor das notas distintas',3000]);
  const csv=buildDetailedCsv(items);expect(csv).toContain('Tentativa');expect(csv).toContain('Revisão necessária');expect(csv).toContain('não somar tentativas');
 });
 it('exports summary imports without dropping amounts or inventing detailed rows',async()=>{
  const summary:SummaryLine[]=[{group_type:'billing_period',group_label:'Agosto',total_invoice_value:1234.56,total_weight_kg:42,total_freight_value:0,total_volume:0,fiscal_document_count:0}];
  expect(closingExportTotals([],summary)).toEqual({value:1234.56,weight:42,freight:0,notes:0,attempts:0});
  expect(buildSummaryCsv(summary)).toContain('1234,56');const wb=buildWorkbook({title:'QA',periodStart:'2026-08-01',periodEnd:'2026-08-31',items:[],summaryLines:summary});
  expect(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Resumo,{header:1})).toContainEqual(['Valor das notas distintas',1234.56]);
 });
});
