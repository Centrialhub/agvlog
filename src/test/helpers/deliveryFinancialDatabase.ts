import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';

interface ColumnContract { table:string;column:string;type:string;nullable:string;default:string|null }
interface FinancialContract {
  columns:ColumnContract[];
  constraints:{table:string;type:string;definition:string}[];
  triggers:{table:string;name:string;definition:string}[];
}
const contract=JSON.parse(readFileSync('docs/qa/DELIVERY-FINANCIAL-SCHEMA-2026-08-30.json','utf8')) as FinancialContract;
const functions=readFileSync('docs/qa/DELIVERY-FINANCIAL-FUNCTIONS-2026-08-30.sql','utf8');

// Uses captured production trigger/builder bodies and column defaults/checks.
// Deliberately not a full Supabase/RLS/Storage fixture. Unreachable branches are
// instrumented: no test can invoke a payment/fiscal provider or delete a load.
export async function installDeliveryFinancialFixture(db:PGlite) {
  for(const table of new Set(contract.columns.map(c=>c.table))){
    const columns=contract.columns.filter(c=>c.table===table).map(c=>
      `${c.column} ${c.type}${c.nullable==='NO'?' not null':''}${c.default===null?'':` default ${c.default}`}`);
    const constraints=contract.constraints.filter(c=>c.table===table).map(c=>c.definition);
    await db.exec(`create table public.${table}(${[...columns,...constraints].join(',')});`);
  }
  await db.exec(`
    alter table public.loads add column origin text,add column destination text,add column load_number text,
      add column total_weight_kg numeric,add column total_pallet_count numeric,add column created_at timestamptz default now(),
      add column vehicle_id uuid,add column driver_id uuid;
    alter table public.dispatch_trips add column notes text;
    alter table public.dispatch_stops add column stop_order integer,add column created_at timestamptz default now();
    alter table public.fiscal_documents add column value numeric,add column freight_value numeric,
      add column weight_kg numeric,add column invoice_number text,add column access_key text,add column recipient text,
      add column recipient_city text,add column recipient_state text,add column sefaz_status text,
      add column cte_emitted_at timestamptz,add column cte_emitted_outbound_id uuid,add column nfse_emitted_at timestamptz,
      add column recipient_cnpj text,add column remitter_cnpj text,add column supplier_id uuid;
    create table public.qa_delivery_side_effects(name text);
    create function public.sync_financial_obligations(uuid,date,date) returns void language sql as
      $$insert into public.qa_delivery_side_effects values('sync_financial_obligations')$$;
    create function public.delete_load_if_empty(uuid) returns void language sql as
      $$insert into public.qa_delivery_side_effects values('delete_load_if_empty')$$;
  `);
  await db.exec(functions);
  const untouched=['fiscal_documents_autofill_recipient_cnpj','trg_fiscal_documents_autolink_supplier',
    'fiscal_documents_enforce_single_outbound','loads_autofill_driver_from_vehicle'];
  for(const name of untouched)await db.exec(`create function public.${name}() returns trigger language plpgsql as $$begin
    if current_setting('qa.delivery_capture',true)='on' then insert into public.qa_delivery_side_effects values(TG_NAME);end if;
    return new;end;$$;`);
  for(const trigger of contract.triggers)await db.exec(trigger.definition+';');
  // Match the no-direct-driver-access boundary of production internal financial APIs.
  await db.exec(`do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('_build_driver_settlement','_log_settlement_event','_on_dispatch_trip_completed_create_settlement',
      '_tg_sync_obligations_from_settlement','_touch_driver_settlements_updated_at') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end;$$;`);
}
