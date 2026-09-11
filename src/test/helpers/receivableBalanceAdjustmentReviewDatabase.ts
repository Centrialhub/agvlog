import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {financeIds as i} from './financeLedgerDatabase';
import {readFileSync} from 'node:fs';
import {createReceivablePortfolioBulkReviewDatabase} from './receivablePortfolioBulkReviewDatabase';
export {portfolioReviewIds as balanceAdjustmentReviewIds,seedCustomerCreditRefundSource} from './receivablePortfolioBulkReviewDatabase';
/** Full real current credit/refund + bulk portfolio; no balance adjustment candidate installed here. */
export async function createReceivableBalanceAdjustmentReviewDatabase(){
 const db=await createReceivablePortfolioBulkReviewDatabase();
 try{
  await db.exec(readFileSync('supabase/migrations/20260911113458_finance_receivable_portfolio_bulk_evidence.sql','utf8'));
  const predecessors=JSON.parse(readFileSync('docs/qa/finance-receivable-balance-adjustment-predecessors-2026-09-11.json','utf8')) as {functions:Array<{signature:string,definition:string}>};
  const lock=predecessors.functions.find(f=>f.signature.startsWith('public._lock_receivable_financial_graph('))!;await db.exec(lock.definition);await db.exec('revoke all on function public._lock_receivable_financial_graph(uuid,uuid) from public,anon,authenticated,service_role');
  const projection=readFileSync('supabase/migrations/20260910010034_finance_fiscal_receivable_projection.sql','utf8');await db.exec(projection.match(/create table public\.finance_fiscal_projection_events \([\s\S]*?\n\);/)![0]);await db.exec(projection.match(/create trigger preserve_finance_fiscal_projection_event[^;]+;/)![0]);
  await db.exec(readFileSync('supabase/migrations/20260910012756_finance_fiscal_queue_worker.sql','utf8'));
  const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
  await db.exec(baseline.match(/CREATE TABLE public\.client_invoice_details \([\s\S]*?\n\);/)![0]);
  const closingLifecycle=readFileSync('supabase/migrations/20260830174819_audit_closing_lifecycle_and_charge_claims.sql','utf8');await db.exec(closingLifecycle.match(/alter table public\.closing_reports add column lifecycle_revision[^;]+;/)![0]);
  for(const match of baseline.matchAll(/ALTER TABLE ONLY public\.cte_documents\n {4}ALTER COLUMN[\s\S]*?;/g))await db.exec(match[0]);
  await db.exec('alter table public.hub_fiscal_emissions add column if not exists provider_document_version bigint');
  await db.exec('alter table public.cte_documents add column if not exists issued_at timestamptz');
  const addon=JSON.parse(readFileSync('docs/qa/finance-receivable-balance-adjustment-addon-predecessors-2026-09-11.json','utf8')) as {functions:Array<{signature:string,definition:string}>};
  for(const f of addon.functions.filter(f=>f.signature.startsWith('finance_private.fiscal_'))){await db.exec(f.definition);const signature=f.signature.replace(/_value jsonb/,'jsonb').replace(/_tenant uuid, _observation uuid/,'uuid,uuid');await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');}
  for(const f of addon.functions.filter(f=>!f.signature.startsWith('finance_private.fiscal_'))){await db.exec(f.definition);const signature=f.signature.replace(/_tenant_id uuid, _invoice_id uuid|_tenant_id uuid, _report_id uuid/,'uuid,uuid').replace(/_tenant uuid, _filters jsonb/,'uuid,jsonb');await db.exec('revoke all on function '+signature+' from public,anon,service_role;grant execute on function '+signature+' to authenticated');}
  const capture=JSON.parse(readFileSync('docs/qa/finance-receivable-balance-adjustment-capture-predecessor-2026-09-11.json','utf8')) as Array<{definition:string,trigger_definition:string}>;
  await db.exec(capture[0].definition);
  if(!(await db.query<{present:boolean}>("select exists(select 1 from pg_trigger where tgrelid='public.hub_fiscal_emissions'::regclass and tgname='finance_capture_fiscal_observation') present")).rows[0].present)await db.exec(capture[0].trigger_definition);
  return db;
 }catch(error){await db.close();throw error;}
}

/** Existing authorized CTe represented locally; database capture/projection only, no provider call. */
export async function seedBalanceAdjustmentFiscalReceivable(db:PGlite){
 const payer=randomUUID(),cte=randomUUID(),emission=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,tax_id,active) values($1,$2,'Fiscal adjustment payer','11222333000181',true)",[payer,i.tenant]);
 await db.query("insert into cte_documents(id,tenant_id,client_id,batch_id,freight_value,net_value,payer_cnpj,issued_at) values($1,$2,$3,gen_random_uuid(),100,100,'11222333000181',clock_timestamp()-interval '2 days')",[cte,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number,sync_attempts,created_at,updated_at) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'42',0,clock_timestamp(),clock_timestamp())",[emission,i.tenant,cte,'1'.repeat(44),'2'.repeat(15)]);
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;
 const result=(await db.query<{v:{status:string,receivable_id:string,issue:string|null}}>('select finance_private.process_fiscal_observation($1,$2) v',[i.tenant,observation])).rows[0].v;
 if(result.status!=='applied')throw Error('Fiscal adjustment fixture not applied:'+JSON.stringify(result));
 return {payer,cte,emission,observation,receivable:result.receivable_id};
}
