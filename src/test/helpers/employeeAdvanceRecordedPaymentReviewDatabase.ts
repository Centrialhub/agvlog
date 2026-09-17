import {readFileSync} from 'node:fs';
import {createReceivableBalanceAdjustmentReviewDatabase} from './receivableBalanceAdjustmentReviewDatabase';
const signature='register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)';
/** Real recorded payment/period chain, with narrow baseline identity and RLS fixture. No payroll generation simulated. */
export async function createEmployeeAdvanceRecordedPaymentReviewDatabase(){const db=await createReceivableBalanceAdjustmentReviewDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 const fn=baseline.match(/CREATE OR REPLACE FUNCTION public\.register_employee_advance\([\s\S]*?\$function\$;/)![0];await db.exec(fn);await db.exec('revoke all on function '+signature+' from public,anon;grant execute on function '+signature+' to authenticated,service_role');
 await db.exec(readFileSync('supabase/migrations/20260911035125_finance_employee_advance_active_company_boundary.sql','utf8'));
 await db.exec(baseline.match(/CREATE OR REPLACE FUNCTION public\.is_tenant_member\([\s\S]*?\$function\$;/)![0]);
 await db.exec('alter table employee_advances enable row level security;grant select,insert,update on employee_advances to authenticated');
 for(const p of baseline.matchAll(/CREATE POLICY employee_advances_(?:select|insert|update)[^;]+;/g))await db.exec(p[0]);

 await db.exec(baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\(\)[\s\S]*?\$function\$;/)![0].replace('FROM public.payables_payments WHERE','FROM finance_private.active_payable_payments WHERE'));
 await db.exec(baseline.match(/CREATE OR REPLACE FUNCTION public\.sync_employee_advance_from_payable\(\)[\s\S]*?\$function\$;/)![0]);
 await db.exec(baseline.match(/CREATE TRIGGER trg_recalc_payable_paid[^;]+;/)![0]);await db.exec(baseline.match(/CREATE TRIGGER trg_sync_employee_advance[^;]+;/)![0]);
 await db.exec(baseline.match(/CREATE UNIQUE INDEX uq_payables_source_category[^;]+;/)![0]);

 return db;
}
