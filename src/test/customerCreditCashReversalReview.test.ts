// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {financialCommand,financialPayload,reversalPayload} from './helpers/receivableFinancialDatabase';
import {readFileSync} from 'node:fs';
import {receivablesOriginPageSchema} from '@/lib/financial/receivablesPageContract';
import {receivablePortfolioSchema} from '@/lib/financial/receivablePortfolioContract';
import {it,expect} from 'vitest';import {createCustomerCreditApplicationDatabase} from './helpers/customerCreditApplicationDatabase';
it('keeps credit40 applied while receiving and returning only cash10 on the same debt',async()=>{const db=await createCustomerCreditApplicationDatabase();try{
 await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
 const captured=JSON.parse(readFileSync('docs/qa/finance-credit-portfolio-predecessors-2026-09-11.json','utf8').replace(/^\uFEFF/,'')) as {functions:Array<{signature:string;definition:string}>};
 for(const f of captured.functions){await db.exec(f.definition);const sig=f.signature.includes('.')?f.signature:'public.'+f.signature;await db.exec('revoke all on function '+sig+' from public,anon,service_role;grant execute on function '+sig+' to authenticated');}
 await db.exec(readFileSync('supabase/migrations/20260911104429_finance_customer_credit_portfolio_composition.sql','utf8'));

await db.exec('begin');await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query("insert into auth.users values($1,'credit-review@example.test','{}') on conflict(id) do nothing",[i.operator]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);const payer=randomUUID(),cte=randomUUID(),emission=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Credit review payer',true)",[payer,i.tenant]);await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,100,100)',[cte,i.tenant,payer]);await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,cte,'1'.repeat(44),'2'.repeat(15)]);
 const process=async()=>{const id=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;return(await operationRpc<{v:{status:string,receivable_id:string,issue:string|null}}>(db,'select process_finance_fiscal_observation($1,$2) v',[i.tenant,id])).rows[0].v;};const first=await process();expect(first.status).toBe('applied');await db.query("insert into bank_accounts(id,tenant_id,name) values('cf600000-0000-4000-8000-000000000001',$1,'Credit review bank')",[i.tenant]);await financialCommand(db,await financialPayload(db,first.receivable_id,{amount_cents:10000}));await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);expect((await process()).status).toBe('applied');const credit=(await db.query<{id:string}>('select id from finance_customer_credits where receivable_id=$1',[first.receivable_id])).rows[0].id;
 const target=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,50,0,'pending','New real debt') returning id",[i.tenant,payer])).rows[0].id;
 const preview=async(amount:string,application:string|null=null)=>(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.customer_credit_application_context($1,$2,$3,$4,$5) v',[i.tenant,credit,target,amount,application])).rows[0].v;
 const context=await preview('4000');expect(context).toMatchObject({eligible:true,blockers:[]});
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:null,action:'apply',amount_cents:'4000',expected_revision:context.revision,reason:'Aplicação real de crédito existente'};
 const write=async(value:unknown)=>(await db.query<{v:{application_id:string}}> ('select finance_private.record_customer_credit_application($1) v',[value])).rows[0].v;
 const result=await write(payload);expect(await write(payload)).toEqual(result);
 const snapshot=async()=>(await db.query<{v:Record<string,unknown>}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,target])).rows[0].v;
 expect(await snapshot()).toMatchObject({cash_received_cents:0,credit_applied_cents:4000,settled_cents:4000,open_cents:1000});
 const receipt=await financialCommand(db,await financialPayload(db,target,{amount_cents:1000}));
 expect(receipt.payment_id).toBeTruthy();
 const portfolio=async()=>{const raw=(await operationRpc<{v:unknown}>(db,'select get_finance_receivable_portfolio_summary($1,null,null,null) v',[i.tenant])).rows[0].v;receivablePortfolioSchema.parse(raw);return raw;};
 expect(await portfolio()).toMatchObject({totals_valid:true,nominal_cents:'5000',received_allocated_cents:'5000',cash_received_cents:'1000',credit_applied_cents:'4000',settled_cents:'5000',open_cents:'0',status_rows:[{cash_received_cents:'1000',credit_applied_cents:'4000',settled_cents:'5000'}]});
 const page=receivablesOriginPageSchema.parse((await operationRpc<{v:unknown}>(db,"select get_finance_receivables_page_by_origin($1,'','all',null,null,null,1,'all') v",[i.tenant])).rows[0].v);
 expect(page.rows.find(x=>x.id===target)).toMatchObject({cash_received_cents:'1000',credit_applied_cents:'4000',settled_cents:'5000',open_cents:'0'});

 expect(await snapshot()).toMatchObject({cash_received_cents:1000,credit_applied_cents:4000,settled_cents:5000,open_cents:0,can_reverse:true,requires_reconciliation:false});
 const beforeApplication=(await db.query('select to_jsonb(e) v from finance_private.customer_credit_application_events e where id=$1',[result.application_id])).rows;
 const reverse=await financialCommand(db,reversalPayload(await financialPayload(db,target),receipt.payment_id!));
 expect(reverse.reversal_id).toBeTruthy();
 expect(await portfolio()).toMatchObject({cash_received_cents:'0',credit_applied_cents:'4000',settled_cents:'4000',open_cents:'1000'});
 expect(await snapshot()).toMatchObject({cash_received_cents:0,credit_applied_cents:4000,settled_cents:4000,open_cents:1000,can_reverse:false,requires_reconciliation:false});
 expect((await db.query('select to_jsonb(e) v from finance_private.customer_credit_application_events e where id=$1',[result.application_id])).rows).toEqual(beforeApplication);
 expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v).toMatchObject({valid:true,available_cents:'6000',applied_cents:'4000'});
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.customer_credit_application_events')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from receivables_payments')).rows[0].n).toBe(2);
 expect((await db.query<{amount:string}>('select amount::text amount from receivable_payment_reversals where id=$1',[reverse.reversal_id])).rows[0].amount).toBe('10.00');
 expect((await db.query<{direction:string;amount:string}>('select transaction_type direction,amount::text amount from bank_transactions where id=$1',[reverse.bank_transaction_id])).rows).toEqual([{direction:'debit',amount:'10.00'}]);
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(3);
 await db.exec('set constraints all immediate;rollback');
 }catch(error){throw new Error(JSON.stringify(error));}finally{await db.close();}},30000);

