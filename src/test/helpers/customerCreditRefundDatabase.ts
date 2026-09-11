import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {financeIds as i} from './financeLedgerDatabase';
import {readFileSync} from 'node:fs';
import {createCashForecastAgendaDatabase} from './cashForecastAgendaDatabase';
import {installCustomerCreditCapturedPredecessors} from './customerCreditApplicationDatabase';
export async function createCustomerCreditRefundDatabase(){
 const db=await createCashForecastAgendaDatabase();try{
  const lifecycle=readFileSync('supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql','utf8');
  const commandTable=lifecycle.match(/create table public\.client_invoice_commands\([\s\S]*?\n\);/)![0];
  await db.exec('alter table public.client_invoices add unique(tenant_id,id);alter table public.closing_reports add unique(tenant_id,id)');await db.exec(commandTable);
  await db.exec('alter table public.receivables add column cte_document_id uuid');
  const fiscalContext=readFileSync('supabase/migrations/20260910012152_finance_receivable_fiscal_context.sql','utf8');await db.exec(fiscalContext.slice(0,fiscalContext.indexOf('do $context$')));
  await installCustomerCreditCapturedPredecessors(db);await db.exec(readFileSync('supabase/migrations/20260911101312_finance_customer_credit_applications.sql','utf8'));
  const captured=JSON.parse(readFileSync('docs/qa/finance-customer-credit-refund-production-predecessors-2026-09-11.json','utf8')) as {functions:Array<{definition:string,signature:string}>};
  for(const f of captured.functions){await db.exec(f.definition);await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');}
  const triggers=JSON.parse(readFileSync('docs/qa/finance-customer-credit-refund-production-triggers-2026-09-11.json','utf8')) as Array<{relation:string,tgname:string,definition:string,function:string}>;
  for(const t of triggers.filter(t=>['finance_private.check_movement_use()','finance_private.check_settlement_movement_link()'].includes(t.function))){if(!(await db.query<{v:boolean}>('select exists(select 1 from pg_trigger where tgrelid=$1::regclass and tgname=$2) v',[t.relation,t.tgname])).rows[0].v)await db.exec(t.definition);}
  const credits=readFileSync('supabase/migrations/20260910011121_finance_fiscal_cancellation_credits.sql','utf8');await db.exec(credits.match(/create trigger preserve_finance_customer_credit[^;]+;/)![0]);
  return db;
 }catch(error){await db.close();throw error;}
}

export async function seedCustomerCreditRefundSource(db:PGlite){
  await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  const payer=randomUUID(),original=randomUUID();
  await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Crédito para previsão',true)",[payer,i.tenant]);
  await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status,description,due_date) values($1,$2,$3,1000,0,'pending','Origem recebida',current_date+5)",[original,i.tenant,payer]);
  const context=(await db.query<{v:{revision:string}}> ('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,original])).rows[0].v;
  const day=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
  await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:original,expected_revision:context.revision,action:'receive',amount_cents:60000,effective_date:day,bank_account_id:i.account,method:'pix',reason:'Recebimento real na fixture de previsão'}]);
  const emission=randomUUID(),observation=randomUUID(),origin=randomUUID(),source=randomUUID();
  // Existing fiscal facts in an isolated fixture; no provider/issuer is called.
  await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number,sync_attempts,created_at,updated_at) values($1,$2,'cte','production','cancelled','recorded',$3,$4,$5,'1',0,clock_timestamp(),clock_timestamp())",[emission,i.tenant,source,'1'.repeat(44),'2'.repeat(15)]);
  await db.query("insert into finance_fiscal_observations(id,tenant_id,emission_id,snapshot_hash,snapshot) values($1,$2,$3,'fixture-cancelled-observation','{}')",[observation,i.tenant,emission]);
  await db.query("insert into finance_fiscal_receivable_origins(id,tenant_id,doc_type,source_id,fiscal_identity,emission_id,receivable_id,observation_id,state,basis) values($1,$2,'cte',$3,'fixture-credit-forecast',$4,$5,$6,'active',$7)",[origin,i.tenant,source,emission,original,observation,{payer_id:payer,payer_document:'11222333000181'}]);
  if((await db.query<{v:unknown}>('select finance_private.release_cancelled_receipts($1,$2,$3) v',[i.tenant,origin,observation])).rows[0].v!==null)throw Error('real fiscal credit failed');
  await db.query("update finance_fiscal_receivable_origins set state='cancelled' where id=$1",[origin]);
  const credit=(await db.query<{id:string}>('select id from finance_customer_credits where receivable_id=$1',[original])).rows[0].id;
  const target=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description,due_date) values($1,$2,500,0,'pending','Destino do crédito',current_date+5) returning id",[i.tenant,payer])).rows[0].id;

 await db.query("update clients set tax_id='11222333000181' where id=$1",[payer]);return {payer,credit,target,original,day};
}
