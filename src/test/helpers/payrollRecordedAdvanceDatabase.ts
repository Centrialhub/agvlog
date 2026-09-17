import {readFileSync} from 'node:fs';
import {createEmployeeAdvanceCanonicalPaymentDatabase} from './employeeAdvanceCanonicalPaymentDatabase';
export async function createPayrollRecordedAdvanceDatabase(candidate=true){
 const db=await createEmployeeAdvanceCanonicalPaymentDatabase(candidate,false);const read=(file:string)=>readFileSync('supabase/migrations/'+file+'.sql','utf8');const baseline=read('20260824224152_baseline');
 try{
 for(const table of ['employee_contracts','employee_incident_actions','payroll_generation_issues','driver_settlement_items']){
  if(!(await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v){await db.exec(baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))![0]);for(const d of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\s+ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(d[0]);await db.exec('alter table public.'+table+' add primary key(id)');}
 }
 await db.exec('alter table payroll_entries add unique(payroll_period_id,employee_id)');
 const source=JSON.parse(readFileSync('docs/qa/finance-payroll-advance-predecessors-2026-09-11.json','utf8')) as {functions:Array<{signature:string,definition:string}>};
 for(const f of source.functions){await db.exec(f.definition);await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');if(!f.signature.startsWith('finance_private.')){await db.exec('grant execute on function '+f.signature+' to service_role');if(!f.signature.startsWith('enforce_payroll_items_locked')&&!f.signature.startsWith('recompute_payroll_entry_totals'))await db.exec('grant execute on function '+f.signature+' to authenticated');}}
 const dedup=read('20260910132406_finance_payroll_reimbursement_source_dedup');await db.exec(dedup.slice(0,dedup.indexOf('do $patch$')));
 const lifecycle=read('20260910133352_finance_payroll_lifecycle_serialization');await db.exec(lifecycle.slice(0,lifecycle.indexOf('do $patch$')));
 await db.exec(baseline.match(/CREATE TRIGGER trg_payroll_items_locked[^;]+;/)![0]);
 const reversals=JSON.parse(readFileSync('docs/qa/finance-payroll-advance-reversal-predecessors-2026-09-11.json','utf8')) as {functions:Array<{signature:string,definition:string}>};for(const f of reversals.functions){await db.exec(f.definition);await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role;grant execute on function '+f.signature+' to authenticated');}
 if(candidate){await db.exec(read('20260911124625_finance_payroll_recorded_employee_advances'));await db.exec(read('20260917082306_compact_employee_advance_payment_position'));}
 return db;
 }catch(error){await db.close();throw error;}
}
