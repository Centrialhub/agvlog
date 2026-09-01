// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyDriverMonitorCommand,
  createDriverMonitorDatabase,
  driverMonitorCreatePayload,
  driverMonitorIds as i,
  driverMonitorUpdatePayload,
} from './helpers/driverMonitorCommandDatabase';
import { operationRpc } from './helpers/operationOutcomeDatabase';

let db: PGlite;
const count = async (table: string) =>
  (await db.query<{ count: number }>('select count(*)::int count from ' + table)).rows[0].count;

beforeAll(async () => { db = await createDriverMonitorDatabase(); }, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });

describe('canonical driver monitor command', { timeout: 15000 }, () => {
  it('creates monitor and immutable history atomically, then replays exactly once', async () => {
    const payload = driverMonitorCreatePayload({ request_id: i.request });
    const first = await applyDriverMonitorCommand(db, payload);
    const replay = await applyDriverMonitorCommand(db, payload);
    await db.exec('set constraints all immediate');
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      confirmed: true,
      request_id: i.request,
      action: 'create',
      status: 'active',
      revision: 0,
    });
    expect(await count('public.driver_route_monitors')).toBe(1);
    expect(await count('public.driver_monitoring_history')).toBe(1);
    expect(await count('private.driver_monitor_commands')).toBe(1);
    await expect(db.query(
      "update public.driver_monitoring_history set reason='tamper'",
    )).rejects.toThrow('driver_monitor_history_is_append_only');
  });

  it('rejects payload mismatch under the same request UUID', async () => {
    const payload = driverMonitorCreatePayload({ request_id: i.request });
    await applyDriverMonitorCommand(db, payload);
    await expect(applyDriverMonitorCommand(db, {
      ...payload,
      changes: { ...payload.changes, total_deliveries: 11 },
    })).rejects.toThrow('driver_monitor_request_key_mismatch');
    expect(await count('public.driver_route_monitors')).toBe(1);
  });

  it('rolls monitor creation back when history fails late', async () => {
    await db.exec(`
      create function public.qa_reject_monitor_history() returns trigger language plpgsql as $$
      begin raise exception 'qa_monitor_history_failure'; end;$$;
      create trigger qa_reject_monitor_history before insert on public.driver_monitoring_history
      for each row execute function public.qa_reject_monitor_history();
    `);
    await expect(applyDriverMonitorCommand(db, driverMonitorCreatePayload()))
      .rejects.toThrow('qa_monitor_history_failure');
    expect(await count('public.driver_route_monitors')).toBe(0);
    expect(await count('private.driver_monitor_commands')).toBe(0);
  });

  it('updates once and rejects a stale concurrent writer by expected revision', async () => {
    const created = await applyDriverMonitorCommand(db, driverMonitorCreatePayload());
    const monitorId = String(created.monitor_id);
    const first = driverMonitorUpdatePayload(monitorId, 0);
    const stale = driverMonitorUpdatePayload(monitorId, 0, {
      changes: { notes: 'Escritor concorrente' },
    });
    const updated = await applyDriverMonitorCommand(db, first);
    expect(updated).toMatchObject({ monitor_id: monitorId, revision: 1 });
    await expect(applyDriverMonitorCommand(db, stale))
      .rejects.toThrow('driver_monitor_revision_conflict');
    expect(await count('public.driver_monitoring_history')).toBe(2);
  });

  it('rejects overlapping active duplicates and accepts the same driver after the prior window', async () => {
    await applyDriverMonitorCommand(db, driverMonitorCreatePayload());
    await expect(applyDriverMonitorCommand(db, driverMonitorCreatePayload()))
      .rejects.toThrow('driver_monitor_overlap');
    const nonOverlapping = driverMonitorCreatePayload({
      changes: {
        ...driverMonitorCreatePayload().changes,
        started_at: '2026-09-04T12:00:00.000Z',
        expected_return_date: '2026-09-06',
      },
    });
    await expect(applyDriverMonitorCommand(db, nonOverlapping)).resolves.toMatchObject({
      confirmed: true,
    });
  });

  it.each([
    ['driver', { changes: { ...driverMonitorCreatePayload().changes, driver_id: i.otherDriver } }, 'invalid_driver'],
    ['vehicle', { changes: { ...driverMonitorCreatePayload().changes, vehicle_id: i.otherVehicle } }, 'invalid_vehicle'],
    ['load', { changes: { ...driverMonitorCreatePayload().changes, load_id: i.otherLoad } }, 'invalid_load'],
  ])('rejects cross-tenant %s references', async (_label, patch, message) => {
    await expect(applyDriverMonitorCommand(db, driverMonitorCreatePayload(patch)))
      .rejects.toThrow('driver_monitor_' + message);
    expect(await count('public.driver_route_monitors')).toBe(0);
  });

  it('rejects a non-operational member and cross-tenant monitor targets', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.viewer]);
    await expect(applyDriverMonitorCommand(db, {
      ...driverMonitorCreatePayload(),
      actor_id: i.viewer,
    })).rejects.toThrow('driver_monitor_not_authorized');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);

    const external = 'da100000-0000-4000-8000-000000000099';
    await db.query(`
      insert into public.driver_route_monitors(
        id,tenant_id,monitor_number,driver_name_snapshot,planned_cities,started_at,
        total_deliveries,completed_deliveries,remaining_deliveries,status,source_type
      ) values($1,$2,'EXT-1','Externo','[]','2026-09-01T12:00:00Z',1,0,1,'active','manual')
    `, [external, i.otherTenant]);
    await expect(applyDriverMonitorCommand(db, driverMonitorUpdatePayload(external, 0)))
      .rejects.toThrow('driver_monitor_not_found');
  });

  it('exposes the RPC only to authenticated and restricts history evidence to operational roles', async () => {
    await applyDriverMonitorCommand(db, driverMonitorCreatePayload());
    const privileges = (await db.query<{
      authenticated: boolean;
      anon: boolean;
      service: boolean;
      command_table: boolean;
    }>(`
      select
        has_function_privilege('authenticated','public.apply_driver_monitor_command(jsonb)','execute') authenticated,
        has_function_privilege('anon','public.apply_driver_monitor_command(jsonb)','execute') anon,
        has_function_privilege('service_role','public.apply_driver_monitor_command(jsonb)','execute') service,
        has_table_privilege('authenticated','private.driver_monitor_commands','select') command_table
    `)).rows[0];
    expect(privileges).toEqual({
      authenticated: true,
      anon: false,
      service: false,
      command_table: false,
    });

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.viewer]);
    const hidden = await operationRpc<{ count: number }>(
      db,
      'select count(*)::int count from public.driver_monitoring_history',
    );
    expect(hidden.rows[0]).toEqual({ count: 0 });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
    const visible = await operationRpc<{ count: number }>(
      db,
      'select count(*)::int count from public.driver_monitoring_history',
    );
    expect(visible.rows[0]).toEqual({ count: 1 });
  });
});
