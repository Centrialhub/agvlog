import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createClosingLifecycleDatabase,createClosingWithClient,closingAction,closingActionPayload} from './closingLifecycleDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const receivableFinancialMigration='20260830183929_audit_receivable_payments_and_reversals.sql';
export const receivableFinancialSql=()=>readFileSync('supabase/migrations/'+receivableFinancialMigration,'utf8');
export async function installReceivableFinancialFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.reverse_receivable_payment('),end=baseline.indexOf('$function$;',start)+12;
 if(start<0)throw new Error('Missing actual reversal baseline');await db.exec(baseline.slice(start,end));
}
export async function createReceivableFinancialDatabase(candidate=true){
 const value=await createClosingLifecycleDatabase();await installReceivableFinancialFixture(value.db);if(candidate)await value.db.exec(receivableFinancialSql());return value;
}
export interface FinancialContext {revision:string;receivable_id:string;report_id:string|null;invoice_id:string|null;amount_cents:number;received_cents:number;open_cents:number;status:string;can_receive:boolean;can_reverse:boolean;can_reconcile:boolean;requires_reconciliation:boolean;payments:Array<{id:string;reversed_at:string|null}>}
export async function financialContext(db:PGlite,receivable:string){return (await operationRpc<{result:FinancialContext}>(db,'select get_receivable_financial_context($1,$2) result',[i.tenant,receivable])).rows[0].result;}
export async function createFinancialScenario(db:PGlite){
 const report=(await createClosingWithClient(db)).report.id;await closingAction(db,await closingActionPayload(db,report));
 await operationRpc(db,'select generate_client_invoice_from_closing($1)',[report]);
 const row=(await db.query<{receivable_id:string;client_invoice_id:string}>('select receivable_id,client_invoice_id from closing_reports where id=$1',[report])).rows[0];
 const bank='cf600000-0000-4000-8000-000000000001';await db.query('insert into bank_accounts(id,tenant_id,name) values($1,$2,$3)',[bank,i.tenant,'Banco QA sem integração']);
 return {report,receivable:row.receivable_id,invoice:row.client_invoice_id,bank};
}
let sequence=1;
export async function financialPayload(db:PGlite,receivable:string,options:Record<string,unknown>={}){
 const date=(await db.query<{qa_day:string}>("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as qa_day")).rows[0].qa_day;
 return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'cf610000-0000-4000-8000-'+String(sequence++).padStart(12,'0'),receivable_id:receivable,
  expected_revision:(await financialContext(db,receivable)).revision,action:'receive',reason:'Conferência financeira QA',amount_cents:1000,effective_date:date,bank_account_id:'cf600000-0000-4000-8000-000000000001',method:'pix',...options};
}
export function reversalPayload(payload:Awaited<ReturnType<typeof financialPayload>>,payment:string){
 const {amount_cents:_,bank_account_id:__,method:___,...rest}=payload;return {...rest,action:'reverse',payment_id:payment};
}
export async function financialCommand(db:PGlite,payload:unknown){
 return (await operationRpc<{result:{payment_id:string|null;reversal_id:string|null;command_id:string;bank_transaction_id:string|null;received_cents:number;open_cents:number;revision:string}}>(db,'select apply_receivable_financial_command($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
}
