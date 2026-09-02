// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPlanningDatabase,
  dispatchPlanning,
  planningPayload,
  seedPlanning,
} from './helpers/planningDatabase';

const hardening = readFileSync(
  'supabase/migrations/20260902021429_harden_planned_stop_coordinates.sql',
  'utf8',
);

let db: PGlite;

beforeAll(async () => {
  db = await createPlanningDatabase({ candidate: true });
  await db.exec(hardening);
});

beforeEach(async () => seedPlanning(db));
afterAll(async () => db?.close());

describe('dispatch planner coordinate propagation through PostgreSQL', () => {
  it('rolls back the whole trip graph when the planner omits the physical coordinates', async () => {
    const payload = planningPayload();
    const missing = { ...payload, stops: payload.stops.map(stop => ({ ...stop, latitude: null, longitude: null })) };
    await expect(dispatchPlanning(db, missing)).rejects.toThrow('planned_stop_coordinates_required');
    expect((await db.query<{ trips: number; stops: number }>(`select
      (select count(*)::int from public.dispatch_trips) trips,
      (select count(*)::int from public.dispatch_stops) stops`)).rows)
      .toEqual([{ trips: 0, stops: 0 }]);
  });

  it('persists the exact operator coordinates on the canonical dispatch stop', async () => {
    const payload = planningPayload();
    await dispatchPlanning(db, payload);
    expect((await db.query<{ latitude: string; longitude: string }>(
      `select latitude::text,longitude::text from public.dispatch_stops`,
    )).rows).toEqual([{ latitude: '-23.5', longitude: '-46.6' }]);
  });
});
