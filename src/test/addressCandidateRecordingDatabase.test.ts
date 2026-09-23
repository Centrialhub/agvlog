// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenant = '10000000-0000-4000-8000-000000000001';
const client = '20000000-0000-4000-8000-000000000001';
const failedClient = '20000000-0000-4000-8000-000000000002';
const stop = '30000000-0000-4000-8000-000000000001';
const canonical = '40000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const snapshot = 'Rua Exemplo, 12, Belo Horizonte';
const migration = readFileSync('supabase/migrations/20260923144034_atomic_address_candidate_recording.sql', 'utf8');
let db: PGlite;

async function record(entityType: string, entityId: string, addressHash = hash, candidates: unknown[] = [{ latitude: -19.9 }]) {
  return db.query('select public.record_address_entity_candidates_v1($1,$2,$3,$4,$5,$6::jsonb) result',
    [tenant, entityType, entityId, snapshot, addressHash, JSON.stringify(candidates)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role service_role; create role authenticated; create role anon;
    create table public.canonical_addresses(id uuid primary key,tenant_id uuid not null,address_hash text not null);
    create table public.clients(id uuid primary key,tenant_id uuid not null,canonical_address_id uuid,address_geocode_status text not null);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid not null,canonical_address_id uuid);
    create table public.address_resolution_queue(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,entity_type text not null,entity_id uuid not null,
      canonical_address_id uuid,address_snapshot text not null,address_hash text not null,status text not null,
      candidates jsonb not null,attempts integer not null,last_error text,processed_at timestamptz,
      next_attempt_at timestamptz,updated_at timestamptz,resolved_lat double precision,resolved_lng double precision,
      resolved_provider text,resolved_accuracy_m double precision,resolved_confidence double precision,
      resolved_at timestamptz,resolved_by uuid,lease_token uuid,lease_expires_at timestamptz,
      unique(tenant_id,entity_type,entity_id));
    grant select,update on public.canonical_addresses to service_role;
    grant select,update on public.clients,public.dispatch_stops to service_role;
    grant select,insert,update on public.address_resolution_queue to service_role;
    insert into public.canonical_addresses values('${canonical}','${tenant}','${hash}');
    insert into public.clients values('${client}','${tenant}','${canonical}','pending'),
      ('${failedClient}','${tenant}','${canonical}','pending');
    insert into public.dispatch_stops values('${stop}','${tenant}','${canonical}');
  `);
  await db.exec(migration);
}, 15000);
afterAll(async () => { await db?.close(); });

describe('atomic geocoding candidate recording', () => {
  it('records the complete candidate set and client status together', async () => {
    await db.exec('set role service_role');
    try {
      await record('client', client, hash, [{ latitude: -19.9 }, { latitude: -19.8 }]);
      expect((await db.query('select status,candidates from public.address_resolution_queue where entity_id=$1', [client])).rows[0])
        .toEqual({ status: 'ambiguous', candidates: [{ latitude: -19.9 }, { latitude: -19.8 }] });
      expect((await db.query('select address_geocode_status from public.clients where id=$1', [client])).rows[0])
        .toEqual({ address_geocode_status: 'ambiguous' });
      await record('client', client, hash, []);
      expect((await db.query('select status,last_error from public.address_resolution_queue where entity_id=$1', [client])).rows[0])
        .toEqual({ status: 'error', last_error: 'no_candidates' });
      expect((await db.query('select address_geocode_status from public.clients where id=$1', [client])).rows[0])
        .toEqual({ address_geocode_status: 'error' });
    } finally { await db.exec('reset role'); }
  });

  it('rejects stale addresses without changing either record', async () => {
    await db.exec('set role service_role');
    try { await expect(record('client', failedClient, 'b'.repeat(64))).rejects.toThrow('address_subject_changed'); }
    finally { await db.exec('reset role'); }
    expect((await db.query('select count(*)::int n from public.address_resolution_queue where entity_id=$1', [failedClient])).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select address_geocode_status from public.clients where id=$1', [failedClient])).rows[0]).toEqual({ address_geocode_status: 'pending' });
  });

  it('does not reopen a resolved review from a stale browser request', async () => {
    await db.exec(`update public.address_resolution_queue set status='resolved' where entity_id='${client}';
      update public.clients set address_geocode_status='verified' where id='${client}';`);
    await db.exec('set role service_role');
    try { await expect(record('client', client)).rejects.toThrow('address_review_already_resolved'); }
    finally { await db.exec('reset role'); }
    expect((await db.query('select status from public.address_resolution_queue where entity_id=$1', [client])).rows[0])
      .toEqual({ status: 'resolved' });
    expect((await db.query('select address_geocode_status from public.clients where id=$1', [client])).rows[0])
      .toEqual({ address_geocode_status: 'verified' });
  });

  it('rolls back the queue when updating the client fails', async () => {
    await db.exec(`create function public.reject_client_status() returns trigger language plpgsql as $$
      begin if new.id='${failedClient}'::uuid then raise exception 'simulated_client_failure'; end if; return new; end$$;
      create trigger reject_client_status before update on public.clients for each row execute function public.reject_client_status();`);
    await db.exec('set role service_role');
    try { await expect(record('client', failedClient)).rejects.toThrow('simulated_client_failure'); }
    finally { await db.exec('reset role'); }
    expect((await db.query('select count(*)::int n from public.address_resolution_queue where entity_id=$1', [failedClient])).rows[0]).toEqual({ n: 0 });
  });

  it('allows a scoped dispatch stop and rejects browser roles', async () => {
    await db.exec('set role service_role');
    try { await record('dispatch_stop', stop); }
    finally { await db.exec('reset role'); }
    expect((await db.query('select status from public.address_resolution_queue where entity_id=$1', [stop])).rows[0]).toEqual({ status: 'pending' });
    await db.exec('set role authenticated');
    try { await expect(record('client', client)).rejects.toThrow(); }
    finally { await db.exec('reset role'); }
  });
});
