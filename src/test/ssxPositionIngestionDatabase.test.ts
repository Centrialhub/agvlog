// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  commitSsx,
  recordSsxError,
  ssxIds as i,
  ssxPositionDatabase,
  type SsxPosition,
} from './helpers/ssxPositionDatabase';

let db: PGlite;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const point = (
  minutes: number,
  hash: string,
  values: Partial<SsxPosition> = {},
): SsxPosition => ({
  captured_at: minutesAgo(minutes),
  lat: -23.55,
  lng: -46.63,
  speed: 35,
  heading: 90,
  telemetry: { IdTrackedUnit: 'UNIT-QA' },
  provider_payload_hash: hash,
  ...values,
});

beforeAll(async () => { db = await ssxPositionDatabase(); });
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`truncate positions_raw,positions_last,ingestion_cursors,vehicle_processing_queue;
    delete from vehicle_tracker_links where id<> '${i.link}';
    update vehicle_tracker_links set active=true,end_at=null,vehicle_id='${i.vehicle}' where id='${i.link}';
    delete from tenant_feature_policy;
    insert into tenant_feature_policy(tenant_id,feature_key,enabled)
    values('${i.tenant}','ssx_enabled',true),('${i.tenant}','ssx_kill_switch',false);`);
});

describe('atomic monotonic SSX position ingestion', () => {
  it('commits history, latest position, cursor and queue together', async () => {
    const older = point(8, 'hash-older-0001');
    const latest = point(3, 'hash-latest-001', { lat: -23.56, speed: 42 });
    const result = await commitSsx(db, [older, latest], { memo: { combo_source: 'broadband' } });
    expect(result).toMatchObject({ attempted: 2, inserted: 2, duplicates: 0, latest_applied: true });
    const rows = await db.query<{ raw: number; lat: number; speed: number; source: Record<string, unknown>; last_success_at: Date; queued: Date }>(
      `select (select count(*) from positions_raw)::int raw,p.lat,p.speed,p.source,
        c.last_success_at,q.last_position_at queued
       from positions_last p join ingestion_cursors c using(tenant_id)
       join vehicle_processing_queue q using(tenant_id,vehicle_id)`,
    );
    expect(rows.rows[0]).toMatchObject({ raw: 2, lat: latest.lat, speed: 42 });
    expect(rows.rows[0].source).toMatchObject({
      provider_unit_id: i.unit,
      tracker_link_id: i.link,
      speed_source: 'provider',
      movement_state: 'moving',
    });
    expect(new Date(rows.rows[0].last_success_at).toISOString()).toBe(latest.captured_at);
    expect(new Date(rows.rows[0].queued).toISOString()).toBe(latest.captured_at);
  });

  it('stores late history without allowing it to regress latest state, cursor or queue', async () => {
    const latest = point(2, 'hash-latest-002', { lat: -22, speed: 51 });
    await commitSsx(db, [latest]);
    const late = point(20, 'hash-late-000001', { lat: -25, speed: 5 });
    const result = await commitSsx(db, [late]);
    expect(result).toMatchObject({ inserted: 1, latest_applied: false });
    const state = await db.query<{ lat: number; success: Date; queued: Date; raw: number }>(
      `select p.lat,c.last_success_at success,q.last_position_at queued,
        (select count(*) from positions_raw)::int raw
       from positions_last p join ingestion_cursors c using(tenant_id)
       join vehicle_processing_queue q using(tenant_id,vehicle_id)`,
    );
    expect(state.rows[0].lat).toBe(-22);
    expect(new Date(state.rows[0].success).toISOString()).toBe(latest.captured_at);
    expect(new Date(state.rows[0].queued).toISOString()).toBe(latest.captured_at);
    expect(state.rows[0].raw).toBe(2);
  });

  it('does not turn an empty provider response into a stopped observation', async () => {
    const latest = point(4, 'hash-observed-001', { speed: 64 });
    await commitSsx(db, [latest]);
    const before = (await db.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(p) row from positions_last p`,
    )).rows[0].row;
    const result = await commitSsx(db, [], { memo: { last_empty_poll: minutesAgo(0) } });
    const after = (await db.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(p) row from positions_last p`,
    )).rows[0].row;
    expect(result).toMatchObject({ attempted: 0, inserted: 0, latest_applied: false });
    expect(after).toEqual(before);
  });

  it('keeps speed unknown until two observations support a calculation', async () => {
    const first = point(10, 'hash-nospeed-001', { speed: null });
    await commitSsx(db, [first]);
    let latest = (await db.query<{ speed: number | null; source: Record<string, unknown> }>(
      'select speed,source from positions_last',
    )).rows[0];
    expect(latest.speed).toBeNull();
    expect(latest.source).toMatchObject({ speed_source: 'unknown', movement_state: 'unknown' });
    await commitSsx(db, [point(5, 'hash-nospeed-002', { speed: null })]);
    latest = (await db.query('select speed,source from positions_last')).rows[0] as typeof latest;
    expect(latest.speed).toBe(0);
    expect(latest.source).toMatchObject({ speed_source: 'computed', movement_state: 'stopped' });
  });

  it('uses the immediately preceding canonical point within the same batch', async () => {
    const previous = point(10, 'hash-batch-prev', { speed: null, lat: -23.55 });
    const latest = point(5, 'hash-batch-last', { speed: null, lat: -23.54 });
    await commitSsx(db, [previous, latest]);
    const row = (await db.query<{ speed: number; source: Record<string, unknown> }>(
      'select speed,source from positions_last',
    )).rows[0];
    expect(row.speed).toBeGreaterThan(13);
    expect(row.speed).toBeLessThan(14);
    expect(row.source).toMatchObject({
      speed_source: 'computed',
      time_since_previous_s: 300,
    });
  });

  it('audits an impossible GPS jump without publishing an impossible speed', async () => {
    const captured = Date.now() - 120_000;
    await commitSsx(db, [point(2, 'hash-jump-start', {
      speed: null, captured_at: new Date(captured).toISOString(),
    })]);
    await commitSsx(db, [point(1, 'hash-jump-end', {
      speed: null, lat: -20, captured_at: new Date(captured + 1000).toISOString(),
    })]);
    const latest = (await db.query<{ speed: number | null; source: Record<string, unknown> }>(
      'select speed,source from positions_last',
    )).rows[0];
    expect(latest.speed).toBeNull();
    expect(latest.source).toMatchObject({
      speed_source: 'invalid_delta',
      movement_state: 'unknown',
    });
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 2 });
  });

  it('rejects pre-binding history and does not calculate speed across a tracker remap', async () => {
    const old = point(10, 'hash-old-binding', { speed: 70 });
    await commitSsx(db, [old]);
    const remappedAt = minutesAgo(2);
    await db.query('update vehicle_tracker_links set active=false,end_at=$1 where id=$2', [remappedAt, i.link]);
    await db.query(
      `insert into vehicle_tracker_links(id,tenant_id,vehicle_id,provider_unit_id,active,start_at)
       values($1,$2,$3,$4,true,$5)`,
      [i.otherLink, i.tenant, i.vehicle, i.unit, remappedAt],
    );
    await expect(commitSsx(db, [old], { link: i.otherLink })).rejects.toThrow(
      /ssx_position_outside_binding_window/,
    );
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 1 });
    await commitSsx(db, [point(1, 'hash-new-binding', {
      speed: null, lat: -22,
    })], { link: i.otherLink });
    const latest = (await db.query<{ speed: number | null; source: Record<string, unknown> }>(
      'select speed,source from positions_last',
    )).rows[0];
    expect(latest.speed).toBeNull();
    expect(latest.source).toMatchObject({
      tracker_link_id: i.otherLink,
      speed_source: 'unknown',
      movement_state: 'unknown',
    });
  });

  it('replays a duplicate without mutating the confirmed latest position', async () => {
    const original = point(6, 'hash-replay-0001', { speed: 27 });
    await commitSsx(db, [original]);
    const result = await commitSsx(db, [original]);
    expect(result).toMatchObject({ attempted: 1, inserted: 0, duplicates: 1, latest_applied: false });
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toMatchObject({ count: 1 });
  });

  it('deduplicates identical hashes within one batch without a double-update failure', async () => {
    const original = point(6, 'hash-same-batch-01', { speed: 27 });
    const result = await commitSsx(db, [original, original]);
    expect(result).toMatchObject({ attempted: 2, inserted: 1, duplicates: 1, latest_applied: true });
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 1 });
  });

  it('rejects a SQL null batch with the canonical validation error', async () => {
    await db.exec('set role service_role');
    try {
      await expect(db.query(
        `select public.commit_ssx_position_batch_v1(
          $1,$2,$3,$4,$5,now(),null,'{}'::jsonb
        )`,
        [i.tenant, i.account, i.unit, i.link, i.vehicle],
      )).rejects.toThrow(/ssx_batch_invalid/);
    } finally {
      await db.exec('reset role').catch(() => {});
    }
  });

  it('rejects hash reuse with divergent payload and preserves the canonical raw row', async () => {
    const original = point(8, 'hash-conflict-01', { lat: -23, speed: 20 });
    await commitSsx(db, [original]);
    await expect(commitSsx(db, [point(2, 'hash-conflict-01', {
      lat: -22, speed: 80,
    })])).rejects.toThrow(/ssx_position_hash_conflict/);
    expect((await db.query<{ lat: number; speed: number }>(
      'select lat,speed from positions_last',
    )).rows[0]).toEqual({ lat: -23, speed: 20 });
  });

  it('does not let an older success erase a newer provider error or backoff', async () => {
    const errorAt = minutesAgo(2);
    await recordSsxError(db, errorAt);
    await commitSsx(db, [point(4, 'hash-old-success')], { receivedAt: minutesAgo(3) });
    const cursor = (await db.query<{
      last_polled_at: Date; last_error: string; backoff_until: Date;
      poll_memo: Record<string, unknown>;
    }>('select last_polled_at,last_error,backoff_until,poll_memo from ingestion_cursors')).rows[0];
    expect(new Date(cursor.last_polled_at).toISOString()).toBe(errorAt);
    expect(cursor.last_error).toBe('provider_error');
    expect(cursor.backoff_until).not.toBeNull();
    expect(cursor.poll_memo).toMatchObject({ error_marker: errorAt });
  });

  it('lets a newer success clear an older provider error', async () => {
    await recordSsxError(db, minutesAgo(5));
    await commitSsx(db, [point(2, 'hash-new-success')], { receivedAt: minutesAgo(1) });
    expect((await db.query(
      'select last_error,last_error_at,backoff_until from ingestion_cursors',
    )).rows[0]).toEqual({ last_error: null, last_error_at: null, backoff_until: null });
  });

  it('replaces a stale working memo when an error clears discovery state', async () => {
    await commitSsx(db, [], {
      receivedAt: minutesAgo(2),
      memo: {
        memo_version: 10,
        poll_working_property: 'IdTrackedUnit',
        poll_working_value_source: 'metadata.id_tracked_unit',
        poll_working_url: 'https://stale.invalid',
      },
    });
    await recordSsxError(db, minutesAgo(1), 'provider_error', undefined, {
      memo_version: 10,
      cleared: true,
      cleared_reason: 'provider_error',
    });
    const memo = (await db.query<{ poll_memo: Record<string, unknown> }>(
      'select poll_memo from ingestion_cursors',
    )).rows[0].poll_memo;
    expect(memo).toEqual({ memo_version: 10, cleared: true, cleared_reason: 'provider_error' });
    expect(memo).not.toHaveProperty('poll_working_property');
    await commitSsx(db, [], {
      receivedAt: new Date().toISOString(),
      memo: {
        memo_version: 10,
        poll_working_property: 'IdTrackedUnit',
        poll_working_value_source: 'metadata.id_tracked_unit',
        poll_working_url: 'https://fresh.invalid',
      },
    });
    const recovered = (await db.query<{ poll_memo: Record<string, unknown> }>(
      'select poll_memo from ingestion_cursors',
    )).rows[0].poll_memo;
    expect(recovered).not.toHaveProperty('cleared');
    expect(recovered).toMatchObject({ poll_working_url: 'https://fresh.invalid' });
  });

  it('updates account cooldown atomically without shortening it or losing settings', async () => {
    await db.query(
      `update integration_accounts set settings='{"keep":"value"}'::jsonb where id=$1`,
      [i.account],
    );
    await db.exec('set role service_role');
    try {
      const observedAt = minutesAgo(2);
      await db.query(
        `select public.record_ssx_account_cooldown_v1(
          $1,$2,$3,$3::timestamptz+interval '5 minutes','Rate limited by SSX (429)'
        )`,
        [i.tenant, i.account, observedAt],
      );
      await db.query(
        `select public.record_ssx_account_cooldown_v1(
          $1,$2,$3,$3::timestamptz+interval '1 minute','Rate limited by SSX (429)'
        )`,
        [i.tenant, i.account, minutesAgo(1)],
      );
    } finally {
      await db.exec('reset role').catch(() => {});
    }
    const account = (await db.query<{
      settings: Record<string, unknown>; poll_cooldown_until: Date;
    }>('select settings,poll_cooldown_until from integration_accounts where id=$1', [i.account])).rows[0];
    const settings = account.settings;
    expect(settings.keep).toBe('value');
    expect(settings).not.toHaveProperty('poll_cooldown_until');
    expect(new Date(account.poll_cooldown_until).getTime()).toBeGreaterThan(
      new Date(minutesAgo(1)).getTime(),
    );
  });

  it('rejects a null error memo with the canonical validation error', async () => {
    await db.exec('set role service_role');
    try {
      await expect(db.query(
        `select public.record_ssx_poll_error_v1(
          $1,$2,$3,$4,$5,now(),'provider_error',now()+interval '1 minute',null
        )`,
        [i.tenant, i.account, i.unit, i.link, i.vehicle],
      )).rejects.toThrow(/ssx_poll_error_invalid/);
    } finally {
      await db.exec('reset role').catch(() => {});
    }
  });

  it('rejects a stale worker after the tracker binding changes without partial writes', async () => {
    await db.query(
      `update vehicle_tracker_links set active=false,end_at=now() where id=$1`,
      [i.link],
    );
    await expect(commitSsx(db, [point(2, 'hash-stale-map1')])).rejects.toThrow(/ssx_tracker_binding_changed/);
    expect((await db.query(
      'select (select count(*) from positions_raw)::int raw,(select count(*) from ingestion_cursors)::int cursors',
    )).rows[0]).toEqual({ raw: 0, cursors: 0 });
  });

  it('prevents ambiguous active bindings at the schema boundary', async () => {
    await expect(db.query(
      `insert into vehicle_tracker_links(id,tenant_id,vehicle_id,provider_unit_id,active,start_at)
       values($1,$2,$3,$4,true,now()-interval '1 hour')`,
      [i.otherLink, i.tenant, i.otherVehicle, i.unit],
    )).rejects.toThrow(/uq_ssx_active_link_per_unit|duplicate key/i);
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 0 });
  });

  it('rejects a corrupt cross-tenant vehicle binding before telemetry writes', async () => {
    await db.query('update vehicle_tracker_links set vehicle_id=$1 where id=$2', [i.otherVehicle, i.link]);
    await expect(commitSsx(db, [point(2, 'hash-cross-tenant')], {
      vehicle: i.otherVehicle,
    })).rejects.toThrow(/ssx_vehicle_tenant_mismatch/);
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 0 });
  });

  it('rechecks the SSX kill switch inside the commit transaction', async () => {
    await db.query(`update tenant_feature_policy set enabled=true where feature_key='ssx_kill_switch'`);
    await expect(commitSsx(db, [point(2, 'hash-killswitch')])).rejects.toThrow(/integration_capability_disabled/);
    expect((await db.query('select count(*)::int count from positions_raw')).rows[0]).toEqual({ count: 0 });
  });

  it('fails closed when the canonical kill-switch row is absent', async () => {
    await db.exec(`delete from tenant_feature_policy where feature_key='ssx_kill_switch'`);
    await expect(commitSsx(db, [point(2, 'hash-missing-kill')])).rejects.toThrow(
      /integration_capability_disabled/,
    );
  });

  it('blocks the shared pre-provider capability guard when a kill-switch row is absent', async () => {
    await db.exec(`delete from tenant_feature_policy where feature_key='ssx_kill_switch';set role service_role`);
    try {
      await expect(db.query(
        `select public.assert_tenant_integration_capability_v1($1,'ssx')`, [i.tenant],
      )).rejects.toThrow(/integration_capability_disabled/);
    } finally {
      await db.exec('reset role').catch(() => {});
    }
  });

  it('rolls back the whole batch when one position is invalid', async () => {
    const valid = point(2, 'hash-valid-00001');
    const invalid = point(1, 'hash-invalid-001', { lat: 95 });
    await expect(commitSsx(db, [valid, invalid])).rejects.toThrow(/ssx_position_value_invalid/);
    expect((await db.query(
      'select (select count(*) from positions_raw)::int raw,(select count(*) from positions_last)::int latest',
    )).rows[0]).toEqual({ raw: 0, latest: 0 });
  });

  it('does not expose the ingestion RPC to authenticated users', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query(
        `select public.commit_ssx_position_batch_v1(
          $1,$2,$3,$4,$5,now(),'[]'::jsonb,'{}'::jsonb
        )`,
        [i.tenant, i.account, i.unit, i.link, i.vehicle],
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec('reset role').catch(() => {});
    }
  });
});
