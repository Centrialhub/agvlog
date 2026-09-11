// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';
import {installPreparedReceiptCostPredecessors} from './helpers/preparedReceiptCostIntegrationDatabase';
import {prepareReceiptImageCallback} from './helpers/preparedReceiptImageCallback';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {expenseReceiptIntentResultSchema} from '@/lib/financial/expenseBatchReceiptClient';
import {expenseArtifactsSchema} from '@/lib/financial/expenseArtifactClient';
import {unloadingEffectiveOriginSchema} from '@/lib/financial/unloadingOriginCorrectionContract';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {expenseCostOriginSchema} from '@/lib/financial/unloadingCostCorrectionContract';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const candidate=()=>readFileSync('supabase/migrations/20260911064852_finance_batch_prepared_receipt_intents.sql','utf8');
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",[i.operator,JSON.stringify({active_tenant_id:i.tenant,role:'authenticated'}),JSON.stringify({'x-agvlog-tenant-id':i.tenant})]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function rpc(name:string,payload:unknown){return(await financeAs<{v:unknown}>(db,i.operator,`select ${name}($1) v`,[payload])).rows[0].v;}
async function setup(){const old=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installPreparedReceiptCostPredecessors(db);await db.exec(candidate());return old;}
async function prepared(context:string,trip:string|null=null,stop:string|null=null,batchRequest=randomUUID()){const command={version:1,tenant_id:i.tenant,request_id:randomUUID(),batch_request_id:batchRequest,expense_id:randomUUID(),context,trip_id:trip,stop_id:stop};const intent=expenseReceiptIntentResultSchema.parse(await rpc('prepare_finance_expense_receipt_intent',command));const image=await prepareReceiptImageCallback(db,'expense_draft',intent.intent_id);return {command,intent,image};}
function batch(p:Awaited<ReturnType<typeof prepared>>,extra:Record<string,unknown>={}){return {version:1,tenant_id:i.tenant,request_id:p.command.batch_request_id,context:p.command.context,trip_id:p.command.trip_id,description:'Conferência com imagem preparada',reason:'Imagem previamente conferida para este lançamento',items:[{id:p.command.expense_id,category:'office',description:'Gasto com documento sanitizado',amount_cents:1200,occurred_on:'2026-08-02',supplier_name:'Fornecedor QA',payee_type:'supplier',receipt_path:null,no_receipt_reason:null,receipt_intent_id:p.intent.intent_id,receipt_artifact_id:p.image.reserved.artifact_id,allocations:[],...extra}]};}
it('accepts real prepared receipts in all five contexts, counts them and replays exactly',async()=>{
 await setup();const trip=randomUUID();await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'completed')",[trip,i.tenant]);
 for(const context of ['trip','office','personnel','maintenance','other']){
  const p=await prepared(context,context==='trip'?trip:null);await p.image.finalize();const payload=batch(p),result=await rpc('record_finance_expense_batch',payload);
  await db.exec('set constraints all immediate');expect(await rpc('record_finance_expense_batch',payload)).toEqual(result);
  const listing=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);
  expect(listing.rows.find(row=>row.id===p.command.expense_id)).toMatchObject({receipt_path:null,no_receipt_reason:null,receipt_artifact_count:1});
  const history=(await db.query<{v:{receipts:Array<{receipt_intent_id:string}>}}>('select get_finance_expense_receipt_artifacts($1,$2) v',[i.tenant,p.command.expense_id])).rows[0].v;
  expenseArtifactsSchema.parse(history);expect(history.receipts).toHaveLength(1);expect(history.receipts[0].receipt_intent_id).toBe(p.intent.intent_id);
  await db.exec('set constraints all deferred');
 }
 expect((await db.query('select count(*)::int n from secure_upload_private.expense_receipt_consumptions')).rows).toEqual([{n:5}]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
},30000);
it('rejects non-trip references, another tenant, another line and unfinished images without money',async()=>{
 await setup();const trip=randomUUID();
 for(const context of ['office','maintenance','other'])await expect(rpc('prepare_finance_expense_receipt_intent',{version:1,tenant_id:i.tenant,request_id:randomUUID(),batch_request_id:randomUUID(),expense_id:randomUUID(),context,trip_id:trip,stop_id:null})).rejects.toMatchObject({code:'22023'});
 const p=await prepared('office');await expect(rpc('prepare_finance_expense_receipt_intent',{...p.command,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
 await expect(rpc('record_finance_expense_batch',batch(p))).rejects.toMatchObject({code:'55000'});
 await p.image.finalize();const wrong=batch(p);wrong.items[0].id=randomUUID();await expect(rpc('record_finance_expense_batch',wrong)).rejects.toMatchObject({code:'42501'});
 expect((await db.query('select count(*)::int n from secure_upload_private.expense_receipt_consumptions')).rows).toEqual([{n:0}]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
},30000);
it('keeps a previously amended cost and its revision exactly unchanged after installing prepared evidence',async()=>{
 const old=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installPreparedReceiptCostPredecessors(db);
 const ctx=(await db.query<{v:{expense_id:string,payable_id:string,revision:string}}>('select finance_private.unloading_cost_correction_context($1,$2,$3) v',[i.tenant,old.charge_id,'12000'])).rows[0].v;
 await rpc('correct_finance_unloading_cost',{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:old.charge_id,expense_id:ctx.expense_id,payable_id:ctx.payable_id,amount_cents:'12000',revision:ctx.revision,reason:'Retificação anterior ao comprovante preparado'});
 const state=async()=>({cost:expenseCostOriginSchema.parse((await db.query<{v:unknown}>('select finance_private.expense_cost_effective($1,$2) v',[i.tenant,ctx.expense_id])).rows[0].v),rows:(await db.query('select to_jsonb(e) expense,to_jsonb(c) charge from finance_expense_items e join finance_unloading_charges c on c.id=e.unloading_id')).rows,columns:(await db.query("select attname,atttypid,attnotnull from pg_attribute where attrelid='finance_expense_items'::regclass and attnum>0 and not attisdropped order by attnum")).rows});
 const before=await state();expect(before.cost.verified).toBe(true);await db.exec(candidate());expect(await state()).toEqual(before);
},30000);

async function delivery(){
 const supplier=randomUUID(),trip=randomUUID(),stop=randomUUID(),doc=randomUUID(),provider=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$3,'Fornecedor devedor QA',true),($2,$3,'Prestador QA distinto',true)",[supplier,provider,i.tenant]);
 await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'completed')",[trip,i.tenant]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,status,client_id,destination) values($1,$2,$3,1,'completed',$4,'Local QA')",[stop,i.tenant,trip,supplier]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status) values($1,$2,$3,$3,'inbound','ready')",[doc,i.tenant,supplier]);
 await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',[i.tenant,stop,doc]);
 const context=(await db.query<{v:{revision:string,issue:string|null}}>('select get_finance_delivery_context($1,$2) v',[i.tenant,stop])).rows[0].v;expect(context.issue).toBeNull();
 return {trip,stop,supplier,provider,revision:context.revision};
}
it('records a real unloading batch with no invented path and leaves collection/cost/cancellation readers verified',async()=>{
 await setup();const d=await delivery(),p=await prepared('trip',d.trip,d.stop);await p.image.finalize();
 const payload=batch(p,{category:'unloading',amount_cents:15000,supplier_id:d.provider,supplier_name:'Prestador QA distinto',due_date:'2026-08-20',stop_id:d.stop,delivery_revision:d.revision});
 await rpc('record_finance_expense_batch',payload);await db.exec('set constraints all immediate');
 const record=(await db.query<{id:string,receivable_id:string,receipt_path:null}>('select id,receivable_id,receipt_path from finance_unloading_charges where delivery_stop_id=$1',[d.stop])).rows[0];expect(record.receipt_path).toBeNull();
 const origin=(await db.query<{v:{verified:boolean,effective:{supplier_id:string,amount_cents:string}}}>('select finance_private.unloading_effective_origin($1,$2) v',[i.tenant,record.id])).rows[0].v;unloadingEffectiveOriginSchema.parse(origin);expect(origin).toMatchObject({verified:true,effective:{supplier_id:d.supplier,amount_cents:'15000'}});
 const cost=expenseCostOriginSchema.parse((await db.query<{v:unknown}>('select finance_private.expense_cost_effective($1,$2) v',[i.tenant,p.command.expense_id])).rows[0].v);expect(cost).toMatchObject({verified:true,effective_amount_cents:'15000'});
 const correction=(await db.query<{v:{eligible:boolean,blockers:unknown[]}}>('select finance_private.unloading_cost_correction_context($1,$2,$3) v',[i.tenant,record.id,'12000'])).rows[0].v;expect(correction.eligible).toBe(true);
 const cancellation=(await db.query<{v:{eligible:boolean,blockers:unknown[]}}>('select finance_private.coordinated_unloading_cancellation_context($1,$2,$3) v',[i.tenant,record.id,'2026-08-03'])).rows[0].v;expect(cancellation.blockers).toEqual([]);expect(cancellation.eligible).toBe(true);
 const list=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);expect(list.rows.find(row=>row.id===p.command.expense_id)).toMatchObject({receipt_artifact_count:1,receipt_path:null,no_receipt_reason:null});
 expect((await db.query('select count(*)::int n from finance_unloading_charges where delivery_stop_id=$1',[d.stop])).rows).toEqual([{n:1}]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
},30000);
it('rejects another authorized actor and rolls back all first-line effects if the final receipt event fails',async()=>{
 await setup();const d=await delivery(),first=await prepared('trip',d.trip,d.stop);await first.image.finalize();
 const second=await prepared('trip',d.trip,null,first.command.batch_request_id);await second.image.finalize();
 const other=randomUUID();await db.query("insert into auth.users values($1,'other-receipt@example.test','{}')",[other]);await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,other]);
 const firstPayload=batch(first,{category:'unloading',amount_cents:15000,supplier_id:d.provider,supplier_name:'Prestador QA distinto',due_date:'2026-08-20',stop_id:d.stop,delivery_revision:d.revision});
 await expect(financeAs(db,other,'select record_finance_expense_batch($1)',[firstPayload])).rejects.toMatchObject({code:'42501'});
 const payload={...firstPayload,items:[...firstPayload.items,...batch(second).items]};
 const counts=async()=>(await db.query("select (select count(*) from finance_expense_items)::int expenses,(select count(*) from finance_unloading_charges)::int charges,(select count(*) from receivables)::int receivables,(select count(*) from payables)::int payables,(select count(*) from finance_commands)::int commands,(select count(*) from finance_events)::int events,(select count(*) from secure_upload_private.expense_receipt_consumptions)::int consumed")).rows;
 const before=await counts();
 await db.exec(`create function public.qa_fail_last_receipt() returns trigger language plpgsql as $$begin if new.action='expense_receipt_attached' and new.artifact_id='${second.image.reserved.artifact_id}'::uuid then raise exception 'qa_last_receipt_event_failed';end if;return new;end$$;create trigger qa_fail_last_receipt before insert on secure_upload_private.events for each row execute function public.qa_fail_last_receipt()`);
 await expect(rpc('record_finance_expense_batch',payload)).rejects.toThrow('qa_last_receipt_event_failed');expect(await counts()).toEqual(before);
 expect((await db.query('select count(*)::int n from secure_upload_private.expense_receipt_batch_tickets')).rows).toEqual([{n:0}]);
 await db.exec('drop trigger qa_fail_last_receipt on secure_upload_private.events');await rpc('record_finance_expense_batch',payload);await db.exec('set constraints all immediate');
 expect((await db.query('select count(*)::int n from secure_upload_private.expense_receipt_consumptions')).rows).toEqual([{n:2}]);
},30000);
