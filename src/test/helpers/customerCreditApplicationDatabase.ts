import {randomUUID} from 'node:crypto';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase';
import {financialCommand,financialPayload} from './receivableFinancialDatabase';
import type {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createInvoiceLifecycleDatabase} from './clientInvoiceLifecycleDatabase';
const sql=(n:string)=>readFileSync('supabase/migrations/'+n+'.sql','utf8');
export async function createCustomerCreditApplicationDatabase(){const {db}=await createInvoiceLifecycleDatabase();try{
 await db.exec('create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');await db.exec(sql('20260909212104_finance_ledger_foundation'));
 // Same real fiscal fixture SQL, retaining the complete NFS-e table installed by invoice lifecycle.
 const helper=readFileSync('src/test/helpers/financeFiscalInvoiceLifecycleFixture.ts','utf8');const block=helper.match(/await db\.exec\(`([\s\S]*?)`\);/)![1];await db.exec(block.replace(/ create table nfse_documents\([\s\S]*?\);/,' '));
 for(const n of ['20260910004550_finance_fiscal_observation_queue','20260910005509_finance_fiscal_receivable_basis','20260910010034_finance_fiscal_receivable_projection','20260910011121_finance_fiscal_cancellation_credits','20260910012152_finance_receivable_fiscal_context','20260910024438_finance_receivable_movement_projection','20260910025658_finance_receipt_allocation_corrections'])await db.exec(sql(n));
 const boundary=sql('20260909235237_finance_legacy_rpc_boundary');await db.exec(boundary.slice(0,boundary.indexOf('-- Wrap')));
 const table=sql('20260909212514_finance_delivery_unloading').match(/create table public\.finance_unloading_charges \([\s\S]*?\n\);/i)![0];await db.exec(table.replace(/ references public\.\w+\([^)]*\)/gi,''));
 const context=sql('20260910210433_finance_unloading_receivable_context');await db.exec(context.slice(0,context.indexOf('do $patch$')));
 await installCustomerCreditCapturedPredecessors(db);
 const collector=sql('20260911082303_finance_cash_forecast_private_collector'),start=collector.indexOf('create function finance_private.forecast_customer_credit_evidence');await db.exec(collector.slice(start,collector.indexOf('create function finance_private.cash_forecast_collect',start)));
 const statements=sql('20260909222851_finance_statement_intake');await db.exec(statements.slice(statements.indexOf('create table public.finance_statement_imports'),statements.indexOf('create function finance_private.bank_entry_active')));
 return db;
 }catch(error){await db.close();throw error;}}

/** Real captured production functions only; caller retains its full schema and collector. */
export async function installCustomerCreditCapturedPredecessors(db:PGlite){
 for(const file of ['finance-credit-application-predecessors-2026-09-11.json','finance-credit-additional-predecessors-2026-09-11.json','finance-credit-invoice-command-predecessors-2026-09-11.json','finance-credit-audit-predecessor-2026-09-11.json']){const captured=JSON.parse(readFileSync('docs/qa/'+file,'utf8').replace(/^\uFEFF/,'')) as {functions:Array<{signature:string,definition:string}>};for(const f of captured.functions){await db.exec(f.definition);const signature=f.signature.startsWith('finance_private.')?f.signature:'public.'+f.signature; if(signature.includes('audit_events'))await db.exec('revoke all on function '+signature+' from public,anon,service_role;grant execute on function '+signature+' to authenticated'); if(!signature.includes('apply_client_invoice_command')&&!signature.includes('audit_events'))await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');}}
}

export async function seedCustomerCreditApplicationSource(db:PGlite){
await db.exec('begin');await db.query("insert into auth.users values($1,'credit-review@example.test','{}') on conflict(id) do nothing",[i.operator]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);const payer=randomUUID(),cte=randomUUID(),emission=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Credit review payer',true)",[payer,i.tenant]);await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,100,100)',[cte,i.tenant,payer]);await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,cte,'1'.repeat(44),'2'.repeat(15)]);
 const process=async()=>{const id=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;return(await operationRpc<{v:{status:string,receivable_id:string,issue:string|null}}>(db,'select process_finance_fiscal_observation($1,$2) v',[i.tenant,id])).rows[0].v;};const first=await process();expect(first.status).toBe('applied');await db.query("insert into bank_accounts(id,tenant_id,name) values('cf600000-0000-4000-8000-000000000001',$1,'Credit review bank')",[i.tenant]);await financialCommand(db,await financialPayload(db,first.receivable_id,{amount_cents:10000}));await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);expect((await process()).status).toBe('applied');const credit=(await db.query<{id:string}>('select id from finance_customer_credits where receivable_id=$1',[first.receivable_id])).rows[0].id;
return {payer,cte,emission,credit,sourceReceivable:first.receivable_id,process};
}
