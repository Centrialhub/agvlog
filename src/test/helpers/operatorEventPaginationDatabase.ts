import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createOperatorEventDatabase } from './operatorEventDatabase';
import { operationIds as i, operationRpc } from './operationOutcomeDatabase';

export const operatorEventPaginationMigration = '20260901190100_add_cursor_operator_event_reader.sql';
export const operatorEventPaginationSql = () => readFileSync(`supabase/migrations/${operatorEventPaginationMigration}`, 'utf8');

export async function createOperatorEventPaginationDatabase() {
  const result = await createOperatorEventDatabase();
  // Supabase grants authenticated callers access to auth.uid(). The compact
  // PGlite fixture creates the helper but does not reproduce that schema grant.
  await result.db.exec(`grant usage on schema auth to authenticated;
    grant select on public.operational_events,public.loads,public.drivers,public.clients,public.vehicles to authenticated;`);
  await result.db.exec(operatorEventPaginationSql());
  return result;
}

export async function listOperatorEventPage(
  db: PGlite,
  filters: Record<string, unknown> = { status: 'all' },
  limit = 2,
  cursor: unknown = null,
  tenant = i.tenant,
) {
  return (await operationRpc<{ result: {
    items: Array<Record<string, unknown>>;
    next_cursor: Record<string, unknown> | null;
  } }>(
    db,
    'select public.list_operational_events_page_v1($1,$2::jsonb,$3,$4::jsonb) result',
    [tenant, JSON.stringify(filters), limit, cursor === null ? null : JSON.stringify(cursor)],
  )).rows[0].result;
}
