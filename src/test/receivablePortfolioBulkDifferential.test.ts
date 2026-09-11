// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {receivablePortfolioSchema} from '@/lib/financial/receivablePortfolioContract';
import {createReceivablePortfolioBulkReviewDatabase,portfolioReviewIds as i,seedCustomerCreditRefundSource} from './helpers/receivablePortfolioBulkReviewDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createReceivablePortfolioBulkReviewDatabase();if(process.env.PORTFOLIO_DIFFERENTIAL_BASELINE_ONLY==='1')return;const sql=readFileSync('supabase/migrations/20260911113458_finance_receivable_portfolio_bulk_evidence.sql','utf8');if(sql.trim().length<100)throw Error('Bulk candidate not ready');await db.exec(sql);},60000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});
async function compare(from:string|null=null,to:string|null=null,client:string|null=null){
 const row=(await db.query<{old:unknown;current:unknown}>('select finance_private.receivable_portfolio_scalar_oracle($1,$2,$3,$4) old,finance_private.receivable_portfolio_summary($1,$2,$3,$4) current',[i.tenant,from,to,client])).rows[0];expect(row.current).toEqual(row.old);return receivablePortfolioSchema.parse(row.current);
}
async function title(amount=100,created='2026-01-01T15:00:00Z',status='pending'){
 return(await db.query<{id:string}>("insert into receivables(tenant_id,amount,received_amount,status,description,created_at,due_date) values($1,$2,0,$3,'Differential title',$4,'2020-01-01') returning id",[i.tenant,amount,status,created])).rows[0].id;
}
it('preserves complete totals for ten thousand unpaid titles and canceled counts',async()=>{
 await db.query("insert into receivables(tenant_id,amount,received_amount,status,description,created_at,due_date) select $1,100,0,'pending','10k differential',timestamp '2026-01-01 15:00:00','2020-01-01' from generate_series(1,10000)",[i.tenant]);await title(999,'2026-01-01T15:00:00Z','cancelled');
 expect(await compare()).toMatchObject({total_titles:10000,canceled_titles:1,totals_valid:true,nominal_cents:'100000000',open_cents:'100000000'});
},60000);
it('preserves Sao Paulo date boundaries, invalid evidence and null global/status totals',async()=>{
 await title(10,'2026-01-02T02:59:59Z');await title(20,'2026-01-02T03:00:00Z');expect(await compare('2026-01-01','2026-01-01')).toMatchObject({total_titles:1,nominal_cents:'1000'});
 await title(30,'infinity');const bad=await compare('2026-01-01','2026-01-01');expect(bad).toMatchObject({totals_valid:false,invalid_titles:1,nominal_cents:null,open_cents:null});expect(bad.status_rows.every(s=>s.nominal_cents===null&&s.open_cents===null)).toBe(true);
});
it('preserves real partial receipt and cash reversal without treating credit as money',async()=>{
 const id=await title();const day=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 const context=async()=>(await db.query<{v:{revision:string}}> ('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,id])).rows[0].v;
 const base={version:1,tenant_id:i.tenant,actor_id:i.operator,receivable_id:id,effective_date:day,reason:'Differential real receipt'};
 const paid=(await db.query<{v:{payment_id:string}}> ('select public.apply_receivable_financial_command($1) v',[{...base,request_id:randomUUID(),expected_revision:(await context()).revision,action:'receive',amount_cents:4000,bank_account_id:i.account,method:'pix'}])).rows[0].v;
 expect(await compare()).toMatchObject({cash_received_cents:'4000',credit_applied_cents:'0',open_cents:'6000'});
 await db.query('select public.apply_receivable_financial_command($1)',[{...base,request_id:randomUUID(),expected_revision:(await context()).revision,action:'reverse',payment_id:paid.payment_id,refund_kind:'money_returned'}]);expect(await compare()).toMatchObject({cash_received_cents:'0',open_cents:'10000'});
});
it('preserves applied credit after a real recorded refund without duplicate cash',async()=>{
 await db.exec('rollback');const {credit,target,day,payer}=await seedCustomerCreditRefundSource(db);
 const movement=(await db.query<{v:{movement_id:string}}> ('select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:20000,occurred_on:day,description:'Existing customer refund',beneficiary_name:'Crédito para previsão',beneficiary_document:'11222333000181',reason:'Differential real refund'}])).rows[0].v.movement_id;
 const context=(await db.query<{v:{revision:string}}> ('select finance_private.customer_credit_refund_context($1,$2,$3,$4) v',[i.tenant,credit,movement,'20000'])).rows[0].v;
 await db.query('select finance_private.record_customer_credit_refund($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,outgoing_movement_id:movement,amount_cents:'20000',expected_revision:context.revision,reason:'Differential registered refund'}]);
 const app=(await db.query<{v:{revision:string}}> ('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,target,'40000'])).rows[0].v;
 await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:null,action:'apply',amount_cents:'40000',expected_revision:app.revision,reason:'Differential application of remaining credit'}]);expect(await compare(null,null,payer)).toMatchObject({cash_received_cents:'0',credit_applied_cents:'40000',open_cents:'10000'});
 await db.query("update clients set tax_id='22333444000182' where id=$1",[payer]);expect(await compare(null,null,payer)).toMatchObject({totals_valid:true,credit_applied_cents:'40000'});
 await db.exec('savepoint immutable_audit');await expect(db.query("delete from finance_events where tenant_id=$1 and action='customer_credit_applied'",[i.tenant])).rejects.toMatchObject({message:'finance_immutable_record'});await db.exec('rollback to savepoint immutable_audit');
 await db.query("update finance_fiscal_receivable_origins set state='active' where id=(select origin_id from finance_customer_credits where id=$1)",[credit]);expect(await compare(null,null,payer)).toMatchObject({totals_valid:false,credit_applied_cents:null,open_cents:null});
});
it('preserves fiscal review and broken invoice/closing graph diagnoses',async()=>{
 let invalid=0;
 for(const column of ['client_invoice_id','closing_report_id','cte_document_id']){
  await db.query("insert into receivables(tenant_id,amount,received_amount,status,description,created_at,"+column+") values($1,100,0,'pending','Broken legacy identity','2026-01-01',$2)",[i.tenant,randomUUID()]);
  invalid++;expect(await compare()).toMatchObject({totals_valid:false,invalid_titles:invalid});
 }
});

it('preserves tenant exclusion, rejected filters and mixed-driver denial',async()=>{
 await title(10);await db.query("insert into receivables(tenant_id,amount,received_amount,status,description,created_at) values($1,999,0,'pending','Other company','2026-01-01')",[i.otherTenant]);expect(await compare()).toMatchObject({total_titles:1,nominal_cents:'1000'});
 for(const name of ['receivable_portfolio_scalar_oracle','receivable_portfolio_summary']){
  await db.exec('savepoint denied_filter');await expect(db.query('select finance_private.'+name+"($1,'2026-02-01','2026-01-01',null)",[i.tenant])).rejects.toMatchObject({code:'22023'});await db.exec('rollback to savepoint denied_filter');
 }
 await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);
 for(const name of ['receivable_portfolio_scalar_oracle','receivable_portfolio_summary']){await db.exec('savepoint denied_driver');await expect(db.query('select finance_private.'+name+'($1,null,null,null)',[i.tenant])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint denied_driver');}
});
it('preserves null, zero and nonfinite legacy projections as diagnostics instead of partial totals',async()=>{
 await title(0);const id=await title(20);await db.query("update receivables set due_date='-infinity' where id=$1",[id]);
 await db.query("insert into receivables(tenant_id,amount,received_amount,status,description,created_at) values($1,30,null,'pending','Null projection','2026-01-01'),($1,40,5,'partial','Unproven received projection','2026-01-01')",[i.tenant]);
 const result=await compare();expect(result).toMatchObject({total_titles:4,invalid_titles:3,totals_valid:false,nominal_cents:null,cash_received_cents:null,credit_applied_cents:null});
});
it('preserves a coherent invoice/closing graph through partial and complete real receipts',async()=>{
 const payer=randomUUID(),invoice=randomUUID(),closing=randomUUID(),id=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Invoice graph payer',true)",[payer,i.tenant]);
 await db.query("insert into client_invoices(id,tenant_id,client_id,receivable_id,total_amount,status,invoice_number) values($1,$2,$3,$4,100,'generated','DIFF-INVOICE')",[invoice,i.tenant,payer,id]);
 await db.query("insert into closing_reports(id,tenant_id,client_id,receivable_id,client_invoice_id,total_amount,received_amount,open_amount,status,payment_status,closing_number,title,report_type,report_model,period_start,period_end) values($1,$2,$3,$4,$5,100,0,100,'invoiced','unpaid','DIFF-CLOSE','Differential closing','freight','standard','2026-01-01','2026-01-31')",[closing,i.tenant,payer,id,invoice]);
 await db.query("insert into receivables(id,tenant_id,client_id,client_invoice_id,closing_report_id,amount,received_amount,status,description,created_at) values($1,$2,$3,$4,$5,100,0,'invoiced','Coherent graph','2026-01-01')",[id,i.tenant,payer,invoice,closing]);
 expect(await compare()).toMatchObject({totals_valid:true,nominal_cents:'10000',open_cents:'10000'});
 const day=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 for(const amount of [4000,6000]){
  const revision=(await db.query<{v:{revision:string}}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,id])).rows[0].v.revision;
  await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,actor_id:i.operator,receivable_id:id,request_id:randomUUID(),expected_revision:revision,action:'receive',amount_cents:amount,effective_date:day,bank_account_id:i.account,method:'pix',reason:'Actual receipt on coherent invoice graph'}]);
  expect((await compare()).totals_valid).toBe(true);
 }
 expect(await compare()).toMatchObject({cash_received_cents:'10000',open_cents:'0'});
});
