import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const financeIds = {
  tenant: '10000000-0000-4000-8000-000000000001',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  operator: '20000000-0000-4000-8000-000000000001',
  driverUser: '20000000-0000-4000-8000-000000000002',
  driver: '30000000-0000-4000-8000-000000000001',
  account: '40000000-0000-4000-8000-000000000001',
  otherAccount: '40000000-0000-4000-8000-000000000002',
};

// Real candidate migration against a narrow dependency fixture. This tests SQL
// authorization/atomicity; it does not claim complete production-schema coverage.
export async function createFinanceLedgerDatabase() {
  const db = new PGlite();
  await prepareFinanceLedgerDatabase(db);
  return db;
}
export async function prepareFinanceLedgerDatabase(db: {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}, createRoles = true) {
  if (createRoles) await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create table public.tenants(id uuid primary key);
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table public.bank_accounts(id uuid primary key,tenant_id uuid,active boolean,name text default 'Banco QA');
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `);
  const i = financeIds;
  await db.query('insert into tenants values($1),($2)', [i.tenant, i.otherTenant]);
  await db.query("insert into auth.users values($1,'operator@example.test','{\"full_name\":\"Financeiro QA\"}'),($2,'driver@example.test','{}')", [i.operator, i.driverUser]);
  await db.query("insert into tenant_memberships values($1,$2,'operator',true),($1,$3,'driver',true)", [i.tenant, i.operator, i.driverUser]);
  await db.query('insert into drivers values($1,$2,$3,true)', [i.driver, i.tenant, i.driverUser]);
  await db.query('insert into bank_accounts(id,tenant_id,active) values($1,$2,true),($3,$4,true)', [i.account, i.tenant, i.otherAccount, i.otherTenant]);
  await db.exec(readFileSync('supabase/migrations/20260909212104_finance_ledger_foundation.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260909213020_finance_movement_queries.sql', 'utf8'));
}

export async function financeAs<T>(db: PGlite, actor: string, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec('savepoint finance_call; set role authenticated');
  try {
    const result = await db.query<T>(sql, params);
    await db.exec('reset role; release savepoint finance_call');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint finance_call; release savepoint finance_call');
    throw error;
  }
}
