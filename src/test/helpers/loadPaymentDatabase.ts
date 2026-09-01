import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createReceivableFinancialDatabase } from './receivableFinancialDatabase.ts';
import { operationIds as i, operationRpc } from './operationOutcomeDatabase.ts';

const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8').replace(/\r\n/g, '\n');
export const loadPaymentMigration = '20260901141149_make_load_payment_recoverable.sql';
export const loadPaymentSql = () => readFileSync(`supabase/migrations/${loadPaymentMigration}`, 'utf8');
export const loadPaymentIds = {
  ...i,
  receivable: 'cf700000-0000-4000-8000-000000000001',
  bank: 'cf700000-0000-4000-8000-000000000002',
  request: 'cf700000-0000-4000-8000-000000000003',
  otherBank: 'cf700000-0000-4000-8000-000000000004',
};

async function installBaselineTable(db: PGlite, table: 'load_payments' | 'load_status_history') {
  const declaration = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  if (!declaration) throw new Error(`Missing baseline ${table}`);
  const exists = (await db.query<{ exists: boolean }>('select to_regclass($1) is not null as exists', [`public.${table}`])).rows[0].exists;
  if (!exists) await db.exec(declaration);
  else {
    const body = declaration.slice(declaration.indexOf('\n') + 1, declaration.lastIndexOf('\n);'));
    const fields = body.split('\n').map(line => line.trim().replace(/,$/, '').replace(/ NOT NULL(?: DEFAULT .*)?$/, ''));
    const columns = new Set((await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table],
    )).rows.map(row => row.column_name));
    for (const field of fields) if (!columns.has(field.split(' ')[0])) await db.exec(`alter table public.${table} add column ${field}`);
  }
  for (const match of baseline.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ALTER COLUMN[\\s\\S]*?;`, 'g'))) {
    await db.exec(match[0]);
  }
  if (!exists) await db.exec(`alter table public.${table} add primary key(id)`);
}

export async function createLoadPaymentDatabase(candidate = true) {
  const value = await createReceivableFinancialDatabase();
  await installBaselineTable(value.db, 'load_payments');
  await installBaselineTable(value.db, 'load_status_history');
  if (candidate) await value.db.exec(loadPaymentSql());
  return value;
}

export async function seedLoadPayment(db: PGlite) {
  const ids = loadPaymentIds;
  await db.query(`
    insert into public.receivables(id, tenant_id, load_id, description, amount, status, received_amount)
    values($1, $2, $3, 'Frete da carga QA', 100, 'pending', 0)
  `, [ids.receivable, ids.tenant, ids.load]);
  await db.query(`
    update public.loads
       set freight_amount=100, received_amount=0, payment_status='unpaid', payment_date=null,
           receivable_id=$1, operational_status='delivered', status='delivered', version=1,
           load_number='QA-LOAD-PAYMENT'
     where tenant_id=$2 and id=$3
  `, [ids.receivable, ids.tenant, ids.load]);
  await db.query('insert into public.bank_accounts(id,tenant_id,name,active) values($1,$2,$3,true)', [ids.bank, ids.tenant, 'Banco QA']);
  await db.query('insert into public.bank_accounts(id,tenant_id,name,active) values($1,$2,$3,true)', [ids.otherBank, ids.otherTenant, 'Banco externo QA']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.operator]);
}

export async function loadPaymentPayload(db: PGlite, options: Record<string, unknown> = {}) {
  const effectiveDate = (await db.query<{ qa_day: string }>("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as qa_day")).rows[0].qa_day;
  return {
    version: 1,
    tenant_id: loadPaymentIds.tenant,
    actor_id: loadPaymentIds.operator,
    request_id: loadPaymentIds.request,
    load_id: loadPaymentIds.load,
    receivable_id: loadPaymentIds.receivable,
    amount_cents: 2500,
    effective_date: effectiveDate,
    bank_account_id: loadPaymentIds.bank,
    method: 'pix',
    notes: 'Parcela QA',
    ...options,
  };
}

export async function applyLoadPayment(db: PGlite, payload: unknown) {
  return (await operationRpc<{ result: Record<string, unknown> }>(
    db, 'select public.apply_load_payment_command($1::jsonb) result', [JSON.stringify(payload)],
  )).rows[0].result;
}
