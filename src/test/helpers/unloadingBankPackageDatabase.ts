import {readFileSync} from 'node:fs';
import {createPeriodMoneyPackageDatabase} from './periodMoneyPackageDatabase';

// Combines the real bank closure fixture with real receivable command bodies.
// Unrelated operational foreign keys and the Supabase platform remain outside
// this fixture. No successful payment, projection or closure is simulated.
export async function createUnloadingBankPackageDatabase(installSourceGuard=true){
 const db=await createPeriodMoneyPackageDatabase();
 const read=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
 const baseline=read('20260824224152_baseline');
 for(const table of ['clients','client_invoices','dispatch_trips','dispatch_stops','fiscal_documents','dispatch_stop_documents']){
  if((await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present)continue;
  const ddl=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!ddl)throw new Error(table);
  await db.exec(ddl);
  for(const match of baseline.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`,'g')))await db.exec(match[0]);
  await db.exec(`alter table public.${table} add primary key(id)`);
 }
 await db.exec('alter table fiscal_documents add column if not exists supplier_id uuid;');
 const credit=read('20260910011121_finance_fiscal_cancellation_credits').match(/create table public\.finance_customer_credits\s*\([\s\S]*?\n\);/i)?.[0];
 if(!credit)throw new Error('credits DDL missing');
 if(!(await db.query<{present:boolean}>("select to_regclass('public.finance_customer_credits') is not null present")).rows[0].present)await db.exec(credit.replace(/ references public\.\w+\([^)]*\)/g,''));
 await db.exec(`create or replace function public.is_tenant_operator_or_admin(t uuid) returns boolean language sql stable as $$select finance_private.can_access(t)$$;
 create or replace function public.is_tenant_admin(t uuid) returns boolean language sql stable as $$select finance_private.can_access(t) and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role='admin')$$;`);
 const financial=read('20260830183929_audit_receivable_payments_and_reversals');
 const commandFunctions=['_guard_receivable_payment_history','_guard_receivable_bank_evidence','_receivable_financial_snapshot','_lock_receivable_financial_graph','_recalc_receivable_received','_sync_receivable_financial_projection','_guard_receivable_ledger','get_receivable_financial_context','apply_receivable_financial_command'];
 for(const name of commandFunctions){
  const body=financial.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$fn\\$;`,'i'))?.[0];if(!body)throw new Error(name);
  await db.exec(body.replace(/^create (?:or replace )?function/i,'create or replace function'));
  const acl=financial.match(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?;`,'i'))?.[0];if(acl)await db.exec(acl);
 }
 await db.exec(`grant execute on function public.get_receivable_financial_context(uuid,uuid),public.apply_receivable_financial_command(jsonb) to authenticated;
 create trigger guard_receivable_payment_history before insert or update or delete on public.receivables_payments for each row execute function public._guard_receivable_payment_history();
 create trigger guard_receivable_bank_evidence before update or delete on public.bank_transactions for each row execute function public._guard_receivable_bank_evidence();
 create trigger trg_recalc_receivable_received after insert or update or delete on public.receivables_payments for each row execute function public._recalc_receivable_received();
 create trigger recalc_receivable_after_reversal after insert on public.receivable_payment_reversals for each row execute function public._recalc_receivable_received();
 create trigger guard_receivable_ledger before update or delete on public.receivables for each row execute function public._guard_receivable_ledger();
 alter table public.receivables_payments add constraint unloading_qa_command_fk foreign key(tenant_id,financial_command_id) references public.receivable_financial_commands(tenant_id,id) deferrable initially deferred;`);
 // Projection table exists in the closure fixture; install the actual functions,
 // grants, trigger and command-body patches following that table's DDL.
 const projection=read('20260910024438_finance_receivable_movement_projection');
 await db.exec(projection.slice(projection.indexOf('create function finance_private.project_receivable_command')));
 await db.exec(read('20260910030634_finance_explicit_receipt_refunds'));
 const unloading=read('20260909212514_finance_delivery_unloading');
 await db.exec(unloading.slice(unloading.indexOf('create function finance_private.delivery_context')));
 await db.exec('create trigger preserve_finance_unloading before update or delete on finance_unloading_charges for each row execute function finance_private.preserve_event()');
 await db.exec(read('20260910203516_finance_period_unloading_flow'));
 if(installSourceGuard){await db.exec(read('20260910205941_finance_unloading_receivable_source_guard'));
 await db.exec(read('20260910210433_finance_unloading_receivable_context'));}
 return db;
}
