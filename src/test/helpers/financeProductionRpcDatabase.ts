import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const productionCompatibilityMigration = readFileSync(
  'supabase/migrations/20260922210823_finance_production_rpc_compatibility.sql', 'utf8',
);

// Captured schema and function bodies, with synthetic rows only. This checks SQL
// execution and access guards, not production triggers, RLS or lock contention.
export async function createFinanceProductionRpcDatabase() {
  const fixture = JSON.parse(readFileSync('src/test/fixtures/financeProductionRpcSchema.json', 'utf8'));
  const db = new PGlite();
  try {
    await db.exec(fixture.setup);
    await db.exec('set check_function_bodies=off');
    for (const sql of fixture.functions) await db.exec(sql);
    let views: string[] = fixture.views;
    while (views.length) {
      const pending: string[] = [];
      for (const sql of views) {
        try { await db.exec(sql); } catch { pending.push(sql); }
      }
      if (pending.length === views.length) throw new Error('Unresolved snapshot view dependencies');
      views = pending;
    }
    for (const schema of fixture.schemas) {
      await db.exec(`grant usage on schema "${schema}" to authenticated;
        grant execute on all functions in schema "${schema}" to authenticated;`);
    }
    await db.exec(`set check_function_bodies=on;
      create unique index on finance_private.atomic_command_results(tenant_id,action,request_id);
      create unique index on public.idempotency_keys(tenant_id,key_value);
      create unique index on public.payables(tenant_id,source_table,source_id,category)
        where source_table is not null and source_id is not null;
      begin; ${productionCompatibilityMigration} commit;`);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
