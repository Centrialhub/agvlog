import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { ssxPositionDatabase, ssxIds } from './ssxPositionDatabase';

export { ssxIds };
export const migrationFile = 'supabase/migrations/20261006155532_align_ssx_cooldown_retry_after_contract.sql';
export const forwardSql = () => readFileSync(migrationFile, 'utf8');
export const rollbackSql = () => readFileSync('docs/qa/ssx-account-cooldown-retry-after-rollback-2026-10-06.sql', 'utf8');

export async function fixture(apply = true) {
  const db = await ssxPositionDatabase();
  try {
    if (apply) await db.exec(forwardSql());
    return db;
  } catch (error) { await db.close(); throw error; }
}
export async function accountCooldown(
  db: PGlite, seconds: number, observed = new Date().toISOString(), tenant = ssxIds.tenant,
) {
  const until = new Date(Date.parse(observed) + seconds * 1000).toISOString();
  await db.exec('set role service_role');
  try {
    return (await db.query<{ result: Record<string, unknown> }>(
      'select public.record_ssx_account_cooldown_v1($1,$2,$3,$4,$5) result',
      [tenant, ssxIds.account, observed, until, 'QA rate limited'],
    )).rows[0].result;
  } finally { await db.exec('reset role'); }
}
export async function unitBackoff(db: PGlite, seconds: number, observed = new Date().toISOString()) {
  await db.exec('set role service_role');
  try {
    return (await db.query<{ result: Record<string, unknown> }>(
      'select public.record_ssx_poll_error_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) result',
      [ssxIds.tenant, ssxIds.account, ssxIds.unit, ssxIds.link, ssxIds.vehicle,
        observed, 'QA rate limited', new Date(Date.parse(observed) + seconds * 1000).toISOString(), '{}'],
    )).rows[0].result;
  } finally { await db.exec('reset role'); }
}
export async function contractSnapshot(db: PGlite) {
  return (await db.query<Record<string, unknown> & { body_hash: string }>(`select p.proname,p.oid,p.prosecdef,p.proconfig,p.proacl::text,p.proowner,p.proargnames,
    md5(replace(p.prosrc,E'\\r\\n',E'\\n')) body_hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('record_ssx_account_cooldown_v1','record_ssx_poll_error_v1')
    order by p.proname`)).rows;
}
