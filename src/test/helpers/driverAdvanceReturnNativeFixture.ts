import {readFileSync} from 'node:fs';
import {createCashForecastAgendaDatabase} from './cashForecastAgendaDatabase';
import {financeIds as ids} from './financeLedgerDatabase';

let db:Awaited<ReturnType<typeof createCashForecastAgendaDatabase>>;
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');

export async function prepareDriverAdvanceReturnNativeFixture(){
 db=await createCashForecastAgendaDatabase();
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.operator]);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
  if(!(await db.query<{present:boolean}>("select to_regclass('finance_private.cost_disposition_returns') is not null present")).rows[0].present){
   await db.exec('revoke all on function finance_private.receipt_movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role');
   for(const name of ['20260911072557_finance_unloading_covered_cost_regularization','20260911072723_finance_effective_cost_disposition_readers','20260911074203_finance_unloading_cost_regularization_public_boundary','20260911074603_finance_cost_disposition_recorded_returns'])await db.exec(migration(name));
  }
  if(!(await db.query<{present:boolean}>("select to_regprocedure('public.record_finance_cost_disposition_return(jsonb)') is not null present")).rows[0].present)await db.exec(migration('20260911080545_finance_cost_disposition_return_public_boundary'));
  await db.exec("revoke all on function finance_private.movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;alter table drivers add column if not exists name text default 'Motorista QA'");
  await db.exec(migration('20260914220500_finance_driver_advance_recorded_returns'));
  await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)",[ids.otherTenant,ids.operator]);
  await db.query("insert into drivers(id,tenant_id,user_id,active,name) values('30000000-0000-4000-8000-000000000002',$1,null,true,'Motorista outra empresa')",[ids.otherTenant]);
  await db.exec('commit');
 }catch(error){
  await db.exec('rollback');
  throw error;
 }
}
