import {readFileSync} from 'node:fs';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection} from './unloadingCostCorrectionDatabase';
import {installPreparedReceiptCostPredecessors} from './preparedReceiptCostIntegrationDatabase';
export const forecastSql=()=>readFileSync('supabase/migrations/20260911082303_finance_cash_forecast_private_collector.sql','utf8');
// Monetary commands, openings, closure evidence and readers are real SQL.
// Fiscal source schemas are original DDL; unrelated operational FKs and fiscal
// provider/queue workers are outside this fixture. No fake successful function.
export async function createCashForecastCollectorDatabase(){
 const db=await createUnloadingCostCorrectionDatabase();
 await db.exec('begin');
 await installUnloadingCostCorrection(db);
 await installPreparedReceiptCostPredecessors(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['cte_documents','nfse_documents','hub_fiscal_emissions','delivery_attempts','closing_report_charge_claims','client_invoice_charges','finance_fiscal_observations','finance_fiscal_projection_jobs','finance_fiscal_receivable_origins']){
  if((await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)continue;
    const sources=[baseline,...['20260830135338_introduce_delivery_attempt_allocations','20260830174819_audit_closing_lifecycle_and_charge_claims','20260910004550_finance_fiscal_observation_queue','20260910010034_finance_fiscal_receivable_projection'].map(n=>readFileSync('supabase/migrations/'+n+'.sql','utf8'))];
  const ddl=sources.map(s=>s.match(new RegExp('create table public\\.'+table+'\\s*\\([\\s\\S]*?\\n\\);','i'))?.[0]).find(Boolean);
  if(!ddl)throw new Error('Missing original DDL '+table);try{await db.exec(ddl.replace(/ foreign key[^\n]+\n/g,'').replace(/ references public\.\w+\([^)]*\)(?: on delete (?:set null|cascade|restrict|no action))?/gi,''));}catch(error){throw new Error('DDL '+table+': '+String(error));}
 }
 await db.exec("alter table finance_fiscal_projection_jobs add column if not exists result jsonb;alter table hub_fiscal_emissions add column if not exists dispatch_state text;alter table fiscal_documents add column if not exists current_delivery_attempt_id uuid;alter table nfse_documents add column if not exists status text,add column if not exists cancelled boolean default false;create table if not exists fiscal_source_reservations(tenant_id uuid,environment text,source_id uuid,outbound_id uuid,nfse_id uuid,primary key(tenant_id,environment,source_id))");
 await db.exec(readFileSync('supabase/migrations/20260910153731_finance_unbilled_freight_summary.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910185517_finance_movement_recording_origin.sql','utf8'));
 await db.exec(forecastSql());
 await db.exec('commit');
 return db;
}
