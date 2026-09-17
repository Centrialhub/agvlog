import {readFileSync} from 'node:fs';
import {createEmployeeAdvanceRecordedPaymentReviewDatabase} from './employeeAdvanceRecordedPaymentReviewDatabase';
export async function createEmployeeAdvanceCanonicalPaymentDatabase(candidate=true,compact=true){const db=await createEmployeeAdvanceRecordedPaymentReviewDatabase();try{
 for(const row of JSON.parse(readFileSync('docs/qa/finance-employee-advance-paid-chain-predecessor-2026-09-11.json','utf8')))await db.exec(row.definition);
 const voidProof=readFileSync('supabase/migrations/20260910185338_finance_void_aware_monetary_proofs.sql','utf8');await db.exec(voidProof.slice(voidProof.indexOf('create function'),voidProof.indexOf('do $')));
 const complement=readFileSync('supabase/migrations/20260911081653_finance_unloading_open_complement_corrections.sql','utf8');const start=complement.indexOf('create table finance_private.expense_open_complement_amendments(');await db.exec(complement.slice(start,complement.indexOf('\n);',start)+3));
 const approval=readFileSync('supabase/migrations/20260911085400_finance_payable_revision_approval.sql','utf8');await db.exec(approval.slice(approval.indexOf('create table finance_private.payable_approval_tickets')));
 const captured=JSON.parse(readFileSync('docs/qa/finance-employee-advance-payment-predecessors-2026-09-11.json','utf8'));
 for(const row of captured.definitions)await db.exec(row.definition);
 await db.exec('revoke all on function finance_private.apply_payable_movement(jsonb) from public,anon,authenticated,service_role;grant execute on function finance_private.apply_payable_movement(jsonb) to authenticated');
 await db.exec('revoke all on function finance_private.approve_payable_revision(jsonb) from public,anon,authenticated,service_role;revoke all on function public.sync_employee_advance_from_payable() from public,anon,authenticated,service_role;grant execute on function public.sync_employee_advance_from_payable() to service_role');
 await db.exec('revoke all on function register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) from public,anon,authenticated,service_role;grant execute on function register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) to service_role;grant execute on function register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) to authenticated');
 await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
 if(candidate)await db.exec(readFileSync('supabase/migrations/20260911124237_finance_employee_advance_canonical_payment.sql','utf8'));
 if(candidate&&compact)await db.exec(readFileSync('supabase/migrations/20260917082306_compact_employee_advance_payment_position.sql','utf8'));

return db;}catch(error){await db.close();throw error;}}
