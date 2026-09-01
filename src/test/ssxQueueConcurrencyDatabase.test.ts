// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Claim = {
  tenant_id: string;
  vehicle_id: string;
  queued_at: Date;
  last_position_at: Date;
  attempts: number;
  claim_token: string;
  lease_until: Date;
};

const tenant = '20000000-0000-4000-8000-000000000001';
const vehicleA = '50000000-0000-4000-8000-000000000001';
const vehicleB = '50000000-0000-4000-8000-000000000002';
const firstPosition = '2026-08-31T20:00:00.000Z';
const newerPosition = '2026-08-31T20:01:00.000Z';
const migration = readFileSync(
  'supabase/migrations/20260831215357_make_ssx_queue_claims_recoverable.sql',
  'utf8',
);

let db: PGlite;

async function enqueue(vehicle = vehicleA, position = firstPosition) {
  await db.query(
    `insert into vehicle_processing_queue(
       tenant_id,vehicle_id,queued_at,last_position_at,attempts,processed_at,last_error
     ) values($1,$2,$3,$3,0,null,null)`,
    [tenant, vehicle, position],
  );
}

async function claim(limit = 20): Promise<Claim[]> {
  return (await db.query<Claim>(
    'select * from claim_vehicle_processing_queue_v1($1,$2)',
    [tenant, limit],
  )).rows;
}

async function ack(item: Claim, success = true, error: string | null = null) {
  return (await db.query<{ acknowledged: boolean }>(
    `select ack_vehicle_processing_queue_v1($1,$2,$3,$4,$5,$6) acknowledged`,
    [tenant, item.vehicle_id, item.claim_token, item.last_position_at, success, error],
  )).rows[0].acknowledged;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.vehicle_processing_queue(
      tenant_id uuid not null,
      vehicle_id uuid not null,
      queued_at timestamptz not null default now(),
      last_position_at timestamptz,
      attempts integer not null default 0,
      processed_at timestamptz,
      last_error text,
      primary key(tenant_id,vehicle_id)
    );
    grant select,update on public.vehicle_processing_queue to service_role;
  `);
  await db.exec(migration);
});

beforeEach(async () => {
  await db.exec('truncate table vehicle_processing_queue');
});

afterAll(async () => {
  await db?.close();
});

describe('SSX vehicle processing queue claim concurrency', () => {
  it('lets two workers contend without receiving the same claim', async () => {
    await enqueue();
    const [workerA, workerB] = await Promise.all([claim(1), claim(1)]);
    const claims = [...workerA, ...workerB];
    expect(claims).toHaveLength(1);
    expect(new Set(claims.map(item => item.claim_token)).size).toBe(1);
    expect(claims[0]).toMatchObject({ vehicle_id: vehicleA, attempts: 1 });
    const leaseCoversWorker = (await db.query<{ covered: boolean }>(
      `select lease_until > clock_timestamp() + interval '400 seconds' covered
       from vehicle_processing_queue where tenant_id=$1 and vehicle_id=$2`,
      [tenant, vehicleA],
    )).rows[0].covered;
    expect(leaseCoversWorker).toBe(true);
    expect(await claim(1)).toEqual([]);
  });

  it('uses SKIP LOCKED claims to divide distinct work between two workers', async () => {
    await enqueue(vehicleA, firstPosition);
    await enqueue(vehicleB, newerPosition);
    const [workerA, workerB] = await Promise.all([claim(1), claim(1)]);
    const claims = [...workerA, ...workerB];
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map(item => item.vehicle_id))).toEqual(new Set([vehicleA, vehicleB]));
    expect(new Set(claims.map(item => item.claim_token)).size).toBe(2);
  });

  it('does not let an old worker erase or complete a newer queued position', async () => {
    await enqueue();
    const oldClaim = (await claim(1))[0];

    // Exact columns written by the monotonic ingestion ON CONFLICT branch. It
    // intentionally does not know about or clear lease columns from this later migration.
    await db.query(
      `update vehicle_processing_queue set
         queued_at=$3,last_position_at=$3,attempts=0,processed_at=null,last_error=null
       where tenant_id=$1 and vehicle_id=$2`,
      [tenant, vehicleA, newerPosition],
    );

    const newClaim = (await claim(1))[0];
    expect(newClaim.last_position_at.toISOString()).toBe(newerPosition);
    expect(newClaim.claim_token).not.toBe(oldClaim.claim_token);
    expect(await ack(oldClaim)).toBe(false);

    const queued = (await db.query<{
      last_position_at: Date;
      processed_at: string | null;
      claim_token: string;
    }>(
      `select last_position_at,processed_at,claim_token
       from vehicle_processing_queue where tenant_id=$1 and vehicle_id=$2`,
      [tenant, vehicleA],
    )).rows[0];
    expect(queued.last_position_at.toISOString()).toBe(newerPosition);
    expect(queued).toMatchObject({ processed_at: null, claim_token: newClaim.claim_token });
    expect(await ack(newClaim)).toBe(true);
  });

  it('backs off a failed revision but makes a newer observation immediately claimable', async () => {
    await enqueue();
    const failed = (await claim(1))[0];
    expect(await ack(failed, false, 'synthetic processing failure')).toBe(true);
    expect(await claim(1)).toEqual([]);

    await db.query(
      `update vehicle_processing_queue set
         queued_at=$3,last_position_at=$3,attempts=0,processed_at=null,last_error=null
       where tenant_id=$1 and vehicle_id=$2`,
      [tenant, vehicleA, newerPosition],
    );
    const retry = await claim(1);
    expect(retry).toHaveLength(1);
    expect(retry[0].last_position_at.toISOString()).toBe(newerPosition);
  });

  it('requires both the lease token and position revision for ACK', async () => {
    await enqueue();
    const item = (await claim(1))[0];
    expect(await ack({ ...item, claim_token: crypto.randomUUID() })).toBe(false);
    expect(await ack({ ...item, last_position_at: new Date(newerPosition) })).toBe(false);
    expect(await ack(item)).toBe(true);
    expect(await ack(item)).toBe(false);
  });

  it('keeps claim and ACK as service-only SECURITY INVOKER functions', async () => {
    const privileges = (await db.query<{
      claim_service: boolean; claim_auth: boolean; claim_anon: boolean;
      ack_service: boolean; ack_auth: boolean; claim_definer: boolean; ack_definer: boolean;
    }>(`
      select
        has_function_privilege('service_role','claim_vehicle_processing_queue_v1(uuid,integer)','execute') claim_service,
        has_function_privilege('authenticated','claim_vehicle_processing_queue_v1(uuid,integer)','execute') claim_auth,
        has_function_privilege('anon','claim_vehicle_processing_queue_v1(uuid,integer)','execute') claim_anon,
        has_function_privilege('service_role','ack_vehicle_processing_queue_v1(uuid,uuid,uuid,timestamptz,boolean,text)','execute') ack_service,
        has_function_privilege('authenticated','ack_vehicle_processing_queue_v1(uuid,uuid,uuid,timestamptz,boolean,text)','execute') ack_auth,
        (select prosecdef from pg_proc where oid='claim_vehicle_processing_queue_v1(uuid,integer)'::regprocedure) claim_definer,
        (select prosecdef from pg_proc where oid='ack_vehicle_processing_queue_v1(uuid,uuid,uuid,timestamptz,boolean,text)'::regprocedure) ack_definer
    `)).rows[0];
    expect(privileges).toEqual({
      claim_service: true, claim_auth: false, claim_anon: false,
      ack_service: true, ack_auth: false, claim_definer: false, ack_definer: false,
    });

    await enqueue();
    await db.exec('set role authenticated');
    await expect(db.query('select * from claim_vehicle_processing_queue_v1($1,1)', [tenant]))
      .rejects.toThrow(/permission denied/i);
    await db.exec('reset role');

    await db.exec('set role service_role');
    const serviceClaims = (await db.query<Claim>(
      'select * from claim_vehicle_processing_queue_v1($1,1)', [tenant],
    )).rows;
    await db.exec('reset role');
    expect(serviceClaims).toHaveLength(1);
  });
});
