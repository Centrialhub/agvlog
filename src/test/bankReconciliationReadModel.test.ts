// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260915184553_finance_legacy_reconciliation_read_model.sql',
  'utf8',
);
const tenant = '10000000-0000-4000-8000-000000000001';
const otherTenant = '10000000-0000-4000-8000-000000000002';
const account = '20000000-0000-4000-8000-000000000001';
const otherAccount = '20000000-0000-4000-8000-000000000002';
type CursorPage = {
  rows: Array<{ id: string; due_date?: string | null }>;
  has_more: boolean;
  next_cursor: { id: string; posted_at?: string; due_date_key?: string } | null;
};
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema finance_private;
    create function finance_private.can_access(_tenant uuid) returns boolean
      language sql stable security definer set search_path=''
      as $$select _tenant::text=current_setting('test.tenant',true)$$;
    create table bank_accounts(id uuid primary key,tenant_id uuid not null);
    create table bank_transactions(
      id uuid primary key,tenant_id uuid not null,bank_account_id uuid not null,
      posted_at timestamptz not null,description text,amount numeric(14,2) not null,
      transaction_type text not null,reconciliation_status text not null,
      document_number text,counterparty_name text,cost_center text
    );
    create table financial_obligations(
      id uuid primary key,tenant_id uuid not null,due_date date,obligation_type text not null,
      description text,counterparty_name text,amount_expected numeric(14,2) not null,
      amount_matched numeric(14,2) not null,open_balance numeric(14,2) not null,
      status text not null,matching_status text not null
    );
    create table financial_matches(
      id uuid primary key,tenant_id uuid not null,bank_transaction_id uuid not null,
      financial_obligation_id uuid not null,amount_matched numeric(14,2) not null,
      status text not null,created_at timestamptz not null
    );
    insert into bank_accounts values
      ('${account}','${tenant}'),('${otherAccount}','${otherTenant}');
    insert into bank_transactions
    select ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      '${tenant}'::uuid,'${account}'::uuid,
      '2026-09-30 12:00:00+00'::timestamptz-g*interval '1 minute',
      'Transação '||g,1.00,'credit','unmatched',g::text,'Contraparte',null
    from generate_series(1,61) g;
    insert into financial_obligations
    select ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      '${tenant}'::uuid,case when g>52 then null else date '2026-09-01'+(g%5) end,
      case when g%2=0 then 'driver_settlement_payment' else 'driver_expense' end,
      'Título '||g,'Motorista',10.00,0,10.00,'pending','unmatched'
    from generate_series(1,55) g;
    insert into financial_matches
    select ('50000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      '${tenant}'::uuid,
      ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
      ('40000000-0000-4000-8000-'||lpad((((g-1)%55)+1)::text,12,'0'))::uuid,
      1.00,'suggested','2026-09-30 13:00:00+00'
    from generate_series(1,61) g;
  `);
  await db.exec(migration);
  await db.query(`select set_config('test.tenant',$1,false)`, [tenant]);
}, 30_000);

afterAll(async () => db.close());

it('returns exact summary totals independently of page size', async () => {
  const result = await db.query<{ value: Record<string, unknown> }>(
    'select get_finance_legacy_reconciliation_summary($1,$2,$3,$4) value',
    [tenant, account, '2026-09-01', '2026-09-30'],
  );
  expect(result.rows[0].value).toMatchObject({
    tenant_id: tenant,
    bank_account_id: account,
    transaction_count: 61,
    inflow_cents: '6100',
    suggestion_count: 61,
    obligation_count: 55,
    unmatched_obligation_count: 55,
  });
});

it('walks transaction pages with the compound posted_at/id cursor without duplicates', async () => {
  const read = async (cursor: unknown) => (await db.query<{ value: CursorPage }>(
    `select list_finance_legacy_reconciliation_rows(
      $1,$2,$3,$4,'transactions','all','','all','all',$5
    ) value`,
    [tenant, account, '2026-09-01', '2026-09-30', cursor],
  )).rows[0].value;
  const first = await read(null);
  const second = await read(first.next_cursor);
  expect(first.rows).toHaveLength(50);
  expect(first.has_more).toBe(true);
  expect(first.next_cursor).toEqual(expect.objectContaining({ posted_at: expect.any(String), id: expect.any(String) }));
  expect(second.rows).toHaveLength(11);
  expect(second.has_more).toBe(false);
  expect(second.next_cursor).toBeNull();
  expect(new Set([...first.rows, ...second.rows].map((row: { id: string }) => row.id)).size).toBe(61);
});

it('uses the normalized due-date/id cursor and leaves null due dates last', async () => {
  const read = async (cursor: unknown) => (await db.query<{ value: CursorPage }>(
    `select list_finance_legacy_reconciliation_rows(
      $1,$2,$3,$4,'obligations','all','','all','all',$5
    ) value`,
    [tenant, account, '2026-09-01', '2026-09-30', cursor],
  )).rows[0].value;
  const first = await read(null);
  const second = await read(first.next_cursor);
  expect(first.rows).toHaveLength(50);
  expect(second.rows).toHaveLength(5);
  expect(second.rows.slice(-3).every((row) => row.due_date === null)).toBe(true);
  expect(new Set([...first.rows, ...second.rows].map((row: { id: string }) => row.id)).size).toBe(55);
});

it('rejects an account outside the active tenant and contains no offset pagination', async () => {
  await expect(db.query(
    'select get_finance_legacy_reconciliation_summary($1,$2,$3,$4)',
    [tenant, otherAccount, '2026-09-01', '2026-09-30'],
  )).rejects.toThrow(/finance_bank_account_not_found/);
  expect(migration).not.toMatch(/\boffset\b/i);
  expect(migration).toContain("coalesce(due_date, '9999-12-31'::date)");
});
