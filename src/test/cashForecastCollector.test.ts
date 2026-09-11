// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createCashForecastCollectorDatabase} from './helpers/cashForecastCollectorDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {cashForecastCollectorSchema} from '@/lib/financial/cashForecastCollectorContract';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';
let db:Awaited<ReturnType<typeof createCashForecastCollectorDatabase>>;
beforeAll(async()=>{db=await createCashForecastCollectorDatabase();if(process.env.FINANCE_FORECAST_CAPTURE_CATALOG==='1'){const catalog=(await db.query("select oid::regprocedure::text signature,md5(replace(prosrc,E'\\r\\n',E'\\n')) source_md5,prosecdef security_definer,provolatile volatility,proconfig config,proacl::text acl,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service_role from pg_proc where pronamespace='finance_private'::regnamespace and proname in('cash_forecast_collect','forecast_movement_evidence','forecast_customer_credit_evidence') order by proname")).rows;writeFileSync('docs/qa/finance-cash-forecast-private-catalog-2026-09-11.json',JSON.stringify({scope:'local_fixture_catalog_not_production',functions:catalog},null,2)+'\n','utf8');}},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência de previsão de caixa'});
async function collect(){const value=cashForecastCollectorSchema.parse((await db.query<{v:unknown}>("select finance_private.cash_forecast_collect($1,'2026-08-31',current_date+30) v",[i.tenant])).rows[0].v);const projected=projectCollectedCashForecast(value,{tenant_id:i.tenant,actor_id:i.operator,cutoff:value.cutoff,period_end:value.period_end,revision:value.revision});expect(projected.collection).toEqual(value);return value;}
async function rpc<T>(name:string,args:unknown[]){return(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,j)=>'$'+(j+1)).join(',')}) v`,args)).rows[0].v;}
async function client(){const id=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Cliente QA',true)",[id,i.tenant]);return id;}
async function title(payer:string,amount=150){return(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,due_date,description) values($1,$2,$3,0,'pending','2026-10-10','Obrigação real QA') returning id",[i.tenant,payer,amount])).rows[0].id;}
it('keeps missing bases unknown and denies anonymous, raw authenticated, foreign and mixed drivers',async()=>{
 const r=await collect();expect(r.base.amount_cents).toBeNull();expect(r.source_issues).toContainEqual({scope:'all',code:'forecast_base_unverified',source_ids:[i.account]});
 for(const role of ['anon','authenticated','service_role']){const access=await db.query<{v:boolean}>('select has_function_privilege($1,$2,\'execute\') v',[role,'finance_private.cash_forecast_collect(uuid,date,date)']);expect(access.rows[0].v).toBe(false);}
 await db.exec('savepoint denied');await expect(db.query("select finance_private.cash_forecast_collect($1,'2026-08-31',current_date+30)",[i.otherTenant])).rejects.toThrow('finance_access_denied');await db.exec('rollback to denied');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);await expect(collect()).rejects.toThrow('finance_access_denied');
});
it('collects all1005 freight sources, never merchandise, and identifies ambiguous title lineage',async()=>{
 const payer=await client();await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,client_id,issue_date,freight_value,value,is_duplicate) select gen_random_uuid(),$1,'inbound','pending',$2,'2026-08-01',1.01,999999,false from generate_series(1,1005)",[i.tenant,payer]);
 const before=await collect();expect(before.origins).toHaveLength(1005);expect(before.origins.reduce((sum,r)=>sum+BigInt(r.nominal_cents!),0n)).toBe(101505n);expect(before.origins.every(r=>r.expected_on===null)).toBe(true);
 const t=await title(payer);await db.query('update receivables set fiscal_document_id=$1 where id=$2',[before.origins[0].source_id,t]);const after=await collect();expect(after.origins).toHaveLength(1005);expect(after.source_issues.some(x=>x.scope==='expanded'&&x.code==='freight_title_lineage_ambiguous')).toBe(true);expect(after.revision).not.toBe(before.revision);
},30000);
it('keeps actual receipt once in cash and subtracts it once from the title, with stable revision',async()=>{
 const payer=await client(),t=await title(payer);const m=await rpc<{movement_id:string}>('record_finance_movement',[{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:5000,occurred_on:'2026-09-01',description:'Recebimento parcial',beneficiary_name:'Cliente QA'}]);
 const context=await rpc<{revision:string}>('get_receivable_financial_context',[i.tenant,t]);await rpc('apply_receivable_financial_command',[{...base(),actor_id:i.operator,receivable_id:t,expected_revision:context.revision,action:'receive',amount_cents:5000,effective_date:'2026-09-01',bank_account_id:i.account,method:'pix',movement_id:m.movement_id}]);
 const result=await collect();expect(result.origins.find(r=>r.source_id===t)).toMatchObject({valid:true,nominal_cents:'15000',fulfilled_cents:'5000',reserved_credit_cents:'0'});expect(result.recorded_after_cutoff).toHaveLength(1);expect(result.recorded_after_cutoff[0].amount_cents).toBe('5000');expect((await collect()).revision).toBe(result.revision);
});
it('uses the actual verified opening and marks the later reconstruction provisional',async()=>{
 await seedAccountCloseStatement(db,'2026-08-31',10000,'2026-09-01','2026-09-30');await seedAccountCloseStatement(db,'2026-09-30',10000,'2026-09-01','2026-09-30');
 const context=await rpc<{revision:string}>('get_finance_statement_period_evidence',[i.tenant,i.account,'2026-09-01','2026-09-30']);await rpc('record_finance_account_opening',[{...base(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:context.revision}]);
 const result=await collect();expect(result.base).toMatchObject({amount_cents:'10000',confirmation:'bank_confirmed'});expect(result.base.components[0].source_id).not.toBeNull();
 const later=cashForecastCollectorSchema.parse((await db.query<{v:unknown}>("select finance_private.cash_forecast_collect($1,'2026-09-01',current_date+30) v",[i.tenant])).rows[0].v);expect(later.base.confirmation).toBe('provisional');
});
it('sums a cash count and bank opening without inventing a shared source ID',async()=>{
 const cash=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,active,name,account_type) values($1,$2,true,'Caixa QA','cash')",[cash,i.tenant]);
 await rpc('record_finance_cash_opening',[{...base(),account_id:cash,effective_from:'2026-09-01',custodian_name:'Responsável QA',counts:[{denomination_cents:10000,quantity:2}]}]);
 await seedAccountCloseStatement(db,'2026-08-31',10000,'2026-09-01','2026-09-30');await seedAccountCloseStatement(db,'2026-09-30',10000,'2026-09-01','2026-09-30');const context=await rpc<{revision:string}>('get_finance_statement_period_evidence',[i.tenant,i.account,'2026-09-01','2026-09-30']);await rpc('record_finance_account_opening',[{...base(),account_id:i.account,from:'2026-09-01',to:'2026-09-30',revision:context.revision}]);
 const r=await collect();expect(r.base).toMatchObject({amount_cents:'30000',confirmation:'mixed_confirmed'});expect(r.base.components).toHaveLength(2);expect(new Set(r.base.components.map(x=>x.source_id)).size).toBe(2);
 await db.query("insert into bank_accounts(id,tenant_id,active,name,account_type) values($1,$2,true,'Legado desconhecido','legacy')",[randomUUID(),i.tenant]);const invalid=await collect();expect(invalid.base.amount_cents).toBeNull();expect(invalid.base.components.some(x=>x.account_kind==='unsupported'&&x.amount_cents===null)).toBe(true);
});
it('keeps paid-without-proof and malformed credit indeterminate, never zero',async()=>{
 const payer=await client();const p=(await db.query<{id:string}>("insert into payables(id,tenant_id,supplier_name,amount,paid_amount,status,description,due_date) values(gen_random_uuid(),$1,'Fornecedor QA',150,150,'paid','Legado sem prova','2026-10-01') returning id",[i.tenant])).rows[0].id;
 const credit=randomUUID();await db.query("insert into finance_customer_credits(id,tenant_id,payer_id,origin_id,receivable_id,payment_id,bank_transaction_id,observation_id,amount_cents,receipt_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,3000,'{}')",[credit,i.tenant,payer,randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
 const r=await collect();expect(r.origins.find(x=>x.source_id===p)).toMatchObject({valid:false,nominal_cents:null,fulfilled_cents:null});expect(r.credits[0]).toMatchObject({credit_id:credit,valid:false,amount_cents:null});expect(r.unassigned_credit_cents).toBeNull();expect(r.source_issues.some(x=>x.code==='forecast_customer_credit_unverified')).toBe(true);
});

it('retains fiscal projection review without inventing an authorized amount or invoice title',async()=>{
 const observation=randomUUID();await db.query("insert into finance_fiscal_observations(id,tenant_id,emission_id,snapshot_hash,snapshot) values($1,$2,$3,'captured-proof','{\"authorization_protocol\":null}')",[observation,i.tenant,randomUUID()]);await db.query("insert into finance_fiscal_projection_jobs(observation_id,tenant_id,status,issue) values($1,$2,'review','missing_protocol')",[observation,i.tenant]);
 const before=await collect();expect(before.origins).toEqual([]);expect(before.source_issues).toContainEqual({scope:'confirmed',code:'forecast_fiscal_projection_pending',source_ids:[observation]});await db.query("update finance_fiscal_projection_jobs set issue='invalid_receivable_amount' where observation_id=$1",[observation]);expect((await collect()).revision).not.toBe(before.revision);
});
it('reads a real closed-period balance and changes provenance after reopening',async()=>{
 await seedAccountCloseStatement(db,'2026-07-31',10000);await seedAccountCloseStatement(db,'2026-08-31',10000);
 await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
 for(const [writer,reader,extra] of [['record_finance_account_opening','get_finance_statement_period_evidence',{}],['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}]] as const){const context=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...base(),...scope,revision:context.revision,...extra}]);}
 const preview=await rpc<{revision:string}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);const closed=await rpc<{closure_id:string,revision:string}>('close_finance_account_period',[{...base(),...scope,revision:preview.revision}]);
 const before=await collect();expect(before.base).toMatchObject({amount_cents:'10000',confirmation:'bank_confirmed'});expect(before.base.components[0]).toMatchObject({source_table:'finance_account_period_closures',source_id:closed.closure_id});
 await rpc('reopen_finance_account_period',[{...base(),closure_id:closed.closure_id,revision:closed.revision}]);const after=await collect();expect(after.base.confirmation).toBe('provisional');expect(after.revision).not.toBe(before.revision);expect(after.base.components[0].source_table).toBe('finance_account_openings');
},30000);
it('does not coerce a malformed receivable amount or postdated cash into current availability',async()=>{
 const payer=await client();const malformed=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,'NaN',0,'pending','Legado inválido') returning id",[i.tenant,payer])).rows[0].id;
 const r=await collect();expect(r.origins.find(x=>x.source_id===malformed)).toMatchObject({valid:false,nominal_cents:null,fulfilled_cents:null});
 const tomorrow=(await db.query<{v:string}>("select (current_date+1)::text v")).rows[0].v;await expect(rpc('record_finance_movement',[{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:tomorrow,description:'Entrada pós-datada registrada',beneficiary_name:'Cliente QA'}])).rejects.toThrow('finance_invalid_realized_movement');
});
it('proves generated receipt and both transfer writers, while retaining orphan cash with a blocking issue',async()=>{
 const payer=await client(),t=await title(payer);const context=await rpc<{revision:string}>('get_receivable_financial_context',[i.tenant,t]);await rpc('apply_receivable_financial_command',[{...base(),actor_id:i.operator,receivable_id:t,expected_revision:context.revision,action:'receive',amount_cents:5000,effective_date:'2026-09-01',bank_account_id:i.account,method:'pix'}]);
 const received=await rpc<{revision:string,payments:Array<{id:string}>}>('get_receivable_financial_context',[i.tenant,t]);await rpc('apply_receivable_financial_command',[{...base(),actor_id:i.operator,receivable_id:t,expected_revision:received.revision,action:'reverse',payment_id:received.payments[0].id,refund_kind:'money_returned',effective_date:'2026-09-02'}]);
 const destination=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,active,name,account_type,account_number) values($1,$2,true,'Outra conta QA','checking','456-7')",[destination,i.tenant]);
 await rpc('record_finance_internal_transfer',[{...base(),source_account_id:i.account,destination_account_id:destination,amount_cents:2000,debited_on:'2026-09-02',credited_on:'2026-09-03',both_recorded:true}]);
 const departure=await rpc<{departure_id:string}>('record_finance_transfer_stage',[{...base(),stage:'depart',source_account_id:i.account,destination_account_id:destination,amount_cents:1000,occurred_on:'2026-09-04',occurred:true}]);await rpc('record_finance_transfer_stage',[{...base(),stage:'arrive',departure_id:departure.departure_id,occurred_on:'2026-09-05',occurred:true}]);
 const valid=await collect();expect(valid.recorded_after_cutoff).toHaveLength(6);expect(valid.source_issues.filter(x=>x.code==='forecast_movement_origin_unverified')).toEqual([]);
 // Owner-seeded pre-command orphan is a diagnostic fixture, never a successful public writer.
 const orphan=(await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,'in','other',1000,'2026-09-06','Órfão legado','Origem sem comando',$3) returning id",[i.tenant,i.account,i.operator])).rows[0].id;
 const invalid=await collect();expect(invalid.recorded_after_cutoff).toHaveLength(7);expect(invalid.source_issues).toContainEqual({scope:'all',code:'forecast_movement_origin_unverified',source_ids:[orphan]});
});
