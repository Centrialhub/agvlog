import {readFileSync} from 'node:fs';
import {createPayrollRecordedAdvanceDatabase} from './payrollRecordedAdvanceDatabase';
import {financeIds as ids} from './financeLedgerDatabase';

let db:Awaited<ReturnType<typeof createPayrollRecordedAdvanceDatabase>>;
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');

export async function prepareEmployeeAdvanceCandidatesNativeFixture(){
 db=await createPayrollRecordedAdvanceDatabase(false);
 await db.exec('create role postgres superuser');
 await db.exec('set role postgres');
 const paymentPredecessors=JSON.parse(readFileSync('docs/qa/finance-employee-advance-payment-predecessors-2026-09-11.json','utf8')) as {definitions:Array<{signature:string,definition:string}>};
 for(const predecessor of paymentPredecessors.definitions)await db.exec(predecessor.definition);
 await db.exec('alter function finance_private.apply_payable_movement(jsonb) owner to postgres;revoke all on function finance_private.apply_payable_movement(jsonb) from public,anon,authenticated,service_role,qa;grant execute on function finance_private.apply_payable_movement(jsonb) to authenticated');
 await db.exec('alter function finance_private.approve_payable_revision(jsonb) owner to postgres;revoke all on function finance_private.approve_payable_revision(jsonb) from public,anon,authenticated,service_role,qa');
 await db.exec('alter function finance_private.paid_projection_chain(uuid,text,uuid) owner to postgres;revoke all on function finance_private.paid_projection_chain(uuid,text,uuid) from public,anon,authenticated,service_role,qa');
 await db.exec('alter function public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) owner to postgres;revoke all on function public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) from public,anon,authenticated,service_role,qa;grant execute on function public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) to service_role,authenticated');
 await db.exec('alter function public.sync_employee_advance_from_payable() owner to postgres;revoke all on function public.sync_employee_advance_from_payable() from public,anon,authenticated,service_role,qa;grant execute on function public.sync_employee_advance_from_payable() to service_role');
 await db.exec(migration('20260911124237_finance_employee_advance_canonical_payment'));
 await db.exec(migration('20260911124625_finance_payroll_recorded_employee_advances'));
 await db.exec(migration('20260911125548_finance_employee_advance_audited_lifecycle'));
 await db.exec(migration('20260914191353_finance_employee_advance_public_catalog'));
 await db.exec(migration('20260917082306_compact_employee_advance_payment_position'));
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.operator]);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
  await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",[ids.otherTenant,ids.operator]);
  await db.exec('commit');
 }catch(error){
  await db.exec('rollback');
  throw error;
 }
}
