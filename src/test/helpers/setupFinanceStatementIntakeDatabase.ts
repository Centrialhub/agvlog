import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createFinanceLedgerDatabase } from './financeLedgerDatabase';

const statementMigrations = [
  '20260909222851_finance_statement_intake.sql',
  '20260909223737_finance_statement_source_verification.sql',
  '20260909230507_finance_statement_queries.sql',
  '20260909231643_finance_statement_identity_review.sql',
  '20260909233625_finance_audit_queries.sql',
  '20260910013543_finance_bank_reconciliation_groups.sql',
  '20260910014238_finance_reconciliation_workspace.sql',
  '20260910015331_finance_reconciliation_history.sql',
  '20260910020543_finance_ofx_statement_intake.sql',
  '20260910021404_finance_native_statement_account.sql',
  '20260910022059_finance_automatic_reference_reconciliation.sql',
  '20260910023208_finance_automatic_reconciliation_status.sql',
  '20260910023911_finance_account_period_review.sql',
  '20260910142923_finance_statement_verification_reauthorization.sql',
];

export async function setupFinanceStatementIntakeDatabase(): Promise<PGlite> {
  const db = await createFinanceLedgerDatabase();
  await db.exec('alter table bank_accounts add column account_number text');
  await db.exec('alter table bank_accounts add column bank_code text,add column branch_number text,add column account_type text');
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated;
    create function finance_private.can_read_receipt(_path text) returns boolean language sql security definer set search_path='' as
      $$select finance_private.can_access(split_part(_path,'/',1)::uuid)$$;
    grant execute on function finance_private.can_read_receipt(text) to authenticated,anon;grant usage on schema finance_private to anon;`);
  for (const migration of statementMigrations) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }
  return db;
}
