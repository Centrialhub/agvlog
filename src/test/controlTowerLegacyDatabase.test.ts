// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { controlTowerDatabase, seedTower, towerRead } from './helpers/controlTowerDatabase';
let db: PGlite;
beforeAll(async () => { db = await controlTowerDatabase(false); await seedTower(db); }, 20000);
afterAll(async () => { await db?.close(); });
describe('legacy control tower reproduction', () => {
  it('baseline reader fails because row_to_jsonb is not a PostgreSQL function', async () => {
    await expect(towerRead(db)).rejects.toThrow(/row_to_jsonb/);
  });
  it('the proposed old revocation makes a still-used API inaccessible', async () => {
    await db.exec('begin;revoke all on function public.get_open_trip_alerts(uuid) from public,anon,authenticated');
    try { await expect(towerRead(db, 'get_open_trip_alerts')).rejects.toThrow(/permission denied/); }
    finally { await db.exec('rollback'); }
  });
});
