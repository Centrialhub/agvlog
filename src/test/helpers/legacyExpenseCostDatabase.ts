import {readFileSync} from 'node:fs';
import {createFinanceLedgerDatabase} from './financeLedgerDatabase';
// Baseline sources, actual builder/payroll/canonical cost commands. Physical route
// fixture is empty and does not claim delivery validation for this cost operation.
export async function createLegacyExpenseCostDatabase(){

 const db=await createFinanceLedgerDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await db.exec(type[0]);
 for(const table of ['clients','cost_centers','dispatch_trips','dispatch_stops','dispatch_stop_documents','dispatch_trip_loads','loads','fiscal_documents','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','receivables','payables','payables_payments','employees','employee_contracts','employee_advances','employee_incident_actions','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues','financial_obligations','maintenance_orders','maintenance_parts','stock_movements','stock_items']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec(`alter table drivers add column name text default 'Motorista QA';alter table fiscal_documents add column current_delivery_attempt_id uuid;
 alter table payroll_entries add unique(payroll_period_id,employee_id);create view finance_private.active_payable_payments as select * from payables_payments;
 create schema control_tower_private;create function control_tower_private.settlement_route_km(uuid,uuid) returns numeric language sql as $$select null::numeric$$;
 create function public._delivery_trip_financial_documents(uuid,uuid) returns setof public.fiscal_documents language sql as $$select * from public.fiscal_documents where false$$;
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;`);
 for(const name of ['_log_settlement_event','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item']){const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!fn)throw new Error(name);await db.exec(fn);}
 const builder=readFileSync('supabase/migrations/20260831114316_separate_planned_and_remaining_route_distance.sql','utf8').match(/CREATE OR REPLACE FUNCTION public\._build_driver_settlement\([\s\S]*?\$function\$\s*;/)?.[0];if(!builder)throw new Error('builder');await db.exec(builder);
 for(const name of ['20260909212514_finance_delivery_unloading','20260909213959_finance_expense_batches','20260910000731_finance_payroll_payment_projection','20260910132406_finance_payroll_reimbursement_source_dedup','20260910133352_finance_payroll_lifecycle_serialization','20260910134948_finance_canonical_trip_cost_settlement'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));

await db.exec(readFileSync('supabase/migrations/20260910155442_finance_legacy_expense_cost_associations.sql','utf8'));return db;
}
