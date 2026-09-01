// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { planningIds as i, seedPlanning } from './helpers/planningDatabase';
import {
  createRouteDraftDeleteDatabase,
  deleteRouteDraft,
  routeDraftDeleteContext,
  routeDraftDeletePayload,
} from './helpers/routeDraftDeleteDatabase';

let db: PGlite;
beforeAll(async () => { db = await createRouteDraftDeleteDatabase(); }, 30_000);
beforeEach(async () => { await seedPlanning(db); });
afterAll(async () => { await db?.close(); });

async function state() {
  return (await db.query(`select jsonb_build_object(
    'drafts',(select jsonb_agg(to_jsonb(value) order by id) from public.route_planning_drafts value),
    'keys',(select jsonb_agg(to_jsonb(value) order by id) from public.idempotency_keys value),
    'audit',(select jsonb_agg(to_jsonb(value) order by id) from public.entity_audit_log value)
  ) value`)).rows[0];
}

describe('route-planning draft delete command', () => {
  it('deletes a matching draft and records idempotency plus audit evidence', async () => {
    const payload = await routeDraftDeletePayload(db);
    await expect(deleteRouteDraft(db, payload)).resolves.toMatchObject({
      draft_id: i.draft,
      confirmed: true,
      deleted: true,
    });
    expect((await db.query('select count(*)::int count from public.route_planning_drafts')).rows).toEqual([{ count: 0 }]);
    expect((await db.query('select operation,result_id from public.idempotency_keys')).rows)
      .toEqual([{ operation: 'route_planning_draft_delete', result_id: i.draft }]);
    expect((await db.query("select action,source from public.entity_audit_log where entity_type='route_planning_draft'")).rows)
      .toEqual([{ action: 'delete', source: 'delete_route_planning_draft_v1' }]);
  });

  it('replays the same request without a second write', async () => {
    const payload = await routeDraftDeletePayload(db);
    const first = await deleteRouteDraft(db, payload);
    const after = await state();
    await expect(deleteRouteDraft(db, payload)).resolves.toEqual(first);
    expect(await state()).toEqual(after);
  });

  it('rejects a changed payload under the same request id', async () => {
    const payload = await routeDraftDeletePayload(db);
    await deleteRouteDraft(db, payload);
    await expect(deleteRouteDraft(db, { ...payload, expected_revision: null }))
      .rejects.toThrow('route_draft_request_key_mismatch');
  });

  it('rejects a stale revision and preserves every row', async () => {
    const payload = await routeDraftDeletePayload(db);
    await db.query("update public.route_planning_drafts set updated_at=updated_at+interval '1 second' where id=$1", [i.draft]);
    const before = await state();
    await expect(deleteRouteDraft(db, payload)).rejects.toThrow('route_draft_context_changed');
    expect(await state()).toEqual(before);
  });

  it('rejects a lifecycle-closed draft even with its current revision', async () => {
    await db.query("update public.route_planning_drafts set status='dispatched',updated_at=clock_timestamp() where id=$1", [i.draft]);
    const context = await routeDraftDeleteContext(db);
    expect(context).toMatchObject({ exists: true, can_delete: false, status: 'dispatched' });
    const payload = await routeDraftDeletePayload(db, { expected_revision: context.revision });
    await expect(deleteRouteDraft(db, payload)).rejects.toThrow('route_draft_lifecycle_closed');
  });

  it('does not reveal or delete another tenant draft', async () => {
    const before = await state();
    const payload = await routeDraftDeletePayload(db, { tenant_id: i.otherTenant });
    await expect(deleteRouteDraft(db, payload)).rejects.toThrow('route_draft_not_authorized');
    expect(await state()).toEqual(before);
  });

  it('confirms an absent local route without inventing a persisted deletion', async () => {
    await db.query('delete from public.route_planning_drafts where id=$1', [i.draft]);
    const context = await routeDraftDeleteContext(db);
    expect(context).toMatchObject({ exists: false, can_delete: true, revision: null });
    const payload = await routeDraftDeletePayload(db);
    await expect(deleteRouteDraft(db, payload)).resolves.toMatchObject({ confirmed: true, deleted: false });
    expect((await db.query('select operation from public.idempotency_keys')).rows)
      .toEqual([{ operation: 'route_planning_draft_delete_absent' }]);
  });

  it('keeps the command unavailable to public and anon', async () => {
    expect((await db.query<{ public_exec: boolean; anon_exec: boolean; auth_exec: boolean }>(`select
      has_function_privilege('public','public.delete_route_planning_draft_v1(jsonb)','execute') public_exec,
      has_function_privilege('anon','public.delete_route_planning_draft_v1(jsonb)','execute') anon_exec,
      has_function_privilege('authenticated','public.delete_route_planning_draft_v1(jsonb)','execute') auth_exec`)).rows[0])
      .toEqual({ public_exec: false, anon_exec: false, auth_exec: true });
  });
});
