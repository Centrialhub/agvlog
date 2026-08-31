import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createInvoiceLifecycleDatabase} from './clientInvoiceLifecycleDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const expenseReviewMigration='20260830203548_audit_driver_expense_reviews.sql';
export const expenseReviewSql=()=>readFileSync('supabase/migrations/'+expenseReviewMigration,'utf8');
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
export async function installExpenseReviewFixture(db:PGlite){
 for(const table of ['financial_obligations','financial_matches','payables']){
  if((await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present)continue;
  const declaration=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!declaration)throw new Error('Missing actual expense fixture '+table);await db.exec(declaration);
  for(const match of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n    ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(match[0]);
  for(const match of baseline.matchAll(new RegExp('ALTER TABLE public\\.'+table+'\\n    ADD CONSTRAINT[\\s\\S]*?;','g')))await db.exec(match[0]);
  await db.exec('alter table public.'+table+' add primary key(id)');
 }
 await db.exec(baseline.match(/CREATE UNIQUE INDEX uq_financial_obligations_source [^;]+;/)![0]);
 // Replace the earlier fixture's unrelated side-effect instrument with the
 // actual production synchronizer. Expense tests never treat a stub as money.
 await db.exec('drop function public.sync_financial_obligations(uuid,date,date)');
 for(const name of ['_driver_trip_ids','sync_financial_obligations','driver_create_expense','add_driver_settlement_manual_expense','mark_driver_settlement_outdated','_tg_mark_outdated_expense','_tg_sync_obligations_from_expense']){
  const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=baseline.indexOf('$function$;',start)+12;if(start<0)throw new Error('Missing actual function '+name);await db.exec(baseline.slice(start,end));
 }
 await db.exec('alter table public.driver_expenses enable row level security;grant select,insert,update,delete on public.driver_expenses to authenticated;grant select on public.drivers to authenticated;');
 for(const policy of baseline.matchAll(/CREATE POLICY [^\n]+ ON public\.driver_expenses[\s\S]*?;/g))await db.exec(policy[0]);
 for(const name of ['trg_driver_expenses_outdate','trg_sync_obligations_from_expense']){
  await db.exec('drop trigger if exists '+name+' on public.driver_expenses');await db.exec(baseline.match(new RegExp('CREATE TRIGGER '+name+' [^;]+;'))![0]);
 }
}
export async function createExpenseReviewDatabase(candidate=true){const value=await createInvoiceLifecycleDatabase();await installExpenseReviewFixture(value.db);if(candidate)await value.db.exec(expenseReviewSql());return value;}
export async function expenseAdmin(db:PGlite){await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);}
export async function seedExpense(db:PGlite,trip:string,overrides:Record<string,unknown>={}){
 const row={tenant_id:i.tenant,dispatch_trip_id:trip,driver_id:i.driver,category:'food',amount:25,expense_at:'2026-08-30T12:00:00Z',payment_source:'driver',reimbursable:true,paid_with_advance:false,no_receipt:true,no_receipt_reason:'Comprovante indisponível em QA',...overrides};
 const fields=Object.keys(row);return (await db.query<{id:string}>('insert into driver_expenses('+fields.join(',')+') values('+fields.map((_,n)=>'$'+(n+1)).join(',')+') returning id',Object.values(row))).rows[0].id;
}
export async function expenseContext(db:PGlite,expense:string){return (await operationRpc<{result:{revision:string;can_approve:boolean;can_reject:boolean;validation_errors:string[]}}>(db,'select get_driver_expense_review_context($1,$2) result',[i.tenant,expense])).rows[0].result;}
let sequence=1;
export async function expensePayload(db:PGlite,expense:string,action='approve'){return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'de100000-0000-4000-8000-'+String(sequence++).padStart(12,'0'),expense_id:expense,action,reason:'Conferência de despesa QA',expected_revision:(await expenseContext(db,expense)).revision};}
export async function expenseCommand(db:PGlite,payload:unknown){return (await operationRpc<{result:Record<string,unknown>}>(db,'select review_driver_expense($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
