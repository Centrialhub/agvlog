import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createPlanningDatabase, planningIds as i } from './planningDatabase';

export const routeDraftDeleteMigration = '20260901190000_make_route_draft_delete_recoverable.sql';
export const routeDraftDeleteSql = () => readFileSync(`supabase/migrations/${routeDraftDeleteMigration}`, 'utf8');

export async function createRouteDraftDeleteDatabase() {
  const db = await createPlanningDatabase({ candidate: true });
  await db.exec(routeDraftDeleteSql());
  return db;
}

async function authenticated<T>(db: PGlite, sql: string, values: unknown[]) {
  await db.exec('set role authenticated');
  try { return await db.query<T>(sql, values); }
  finally { await db.exec('reset role'); }
}

export async function routeDraftDeleteContext(db: PGlite, tenant = i.tenant, draft = i.draft) {
  return (await authenticated<{ result: {
    revision: string | null;
    exists: boolean;
    can_delete: boolean;
    status: string | null;
  } }>(db, 'select public.get_route_planning_draft_delete_context_v1($1,$2) result', [tenant, draft])).rows[0].result;
}

export async function routeDraftDeletePayload(db: PGlite, overrides: Record<string, unknown> = {}) {
  const context = await routeDraftDeleteContext(db);
  return {
    version: 1,
    tenant_id: i.tenant,
    actor_id: i.operator,
    request_id: randomUUID(),
    draft_id: i.draft,
    expected_revision: context.revision,
    ...overrides,
  };
}

export async function deleteRouteDraft(db: PGlite, payload: unknown) {
  return (await authenticated<{ result: Record<string, unknown> }>(
    db,
    'select public.delete_route_planning_draft_v1($1::jsonb) result',
    [JSON.stringify(payload)],
  )).rows[0].result;
}
