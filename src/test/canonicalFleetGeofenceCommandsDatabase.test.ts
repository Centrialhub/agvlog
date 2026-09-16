// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const stage = readFileSync(
  'supabase/migrations/20260916165000_stage_canonical_fleet_geofence_commands.sql',
  'utf8',
);
const enforcement = readFileSync(
  'supabase/migrations/20260916170000_enforce_canonical_fleet_geofence_writes.sql',
  'utf8',
);

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  tenant: '20000000-0000-4000-8000-000000000001',
  otherTenant: '20000000-0000-4000-8000-000000000002',
  fleet: '30000000-0000-4000-8000-000000000001',
  delivery: '30000000-0000-4000-8000-000000000002',
  stop: '40000000-0000-4000-8000-000000000001',
  toggleRequest: '50000000-0000-4000-8000-000000000001',
  deleteRequest: '50000000-0000-4000-8000-000000000002',
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    grant usage on schema public,auth,private to authenticated;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${ids.actor}');
    create function auth.uid() returns uuid language sql stable as
      $$select '${ids.actor}'::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select '${ids.tenant}'::uuid$$;
    create function private.is_request_tenant_member(uuid) returns boolean language sql stable as
      $$select $1='${ids.tenant}'::uuid$$;
    create function public.is_tenant_admin(uuid) returns boolean language sql stable as
      $$select $1='${ids.tenant}'::uuid$$;
    create table public.geofences(
      id uuid primary key,tenant_id uuid not null,name text not null,enabled boolean not null,
      scope_kind text not null,dispatch_stop_id uuid
    );
    alter table public.geofences enable row level security;
    grant select,insert,update,delete on public.geofences to authenticated,service_role;
    create table public.operator_command_ledger(
      tenant_id uuid not null,request_id uuid not null,actor_id uuid not null references auth.users(id),
      action text not null check(action in('resolve_address','upsert_geofence','review_trip_cargo_divergence')),
      entity_type text not null,entity_id uuid not null,payload_hash text not null,
      response jsonb not null,created_at timestamptz not null default clock_timestamp(),
      primary key(tenant_id,request_id)
    );
  `);
  await db.exec(stage);
  expect((await db.query<{ allowed: boolean }>(
    `select has_table_privilege('authenticated','public.geofences','update') allowed`,
  )).rows[0]).toEqual({ allowed: true });
  await db.exec(enforcement);
});

beforeEach(async () => {
  await db.exec(`
    truncate public.operator_command_ledger,public.geofences;
    insert into public.geofences values
      ('${ids.fleet}','${ids.tenant}','Garagem',true,'fleet',null),
      ('${ids.delivery}','${ids.tenant}','Entrega',true,'delivery','${ids.stop}');
  `);
});

afterAll(async () => { await db?.close(); });

async function call(payload: Record<string, unknown>) {
  await db.exec('set role authenticated');
  try {
    return (await db.query<{ result: Record<string, unknown> }>(
      'select public.mutate_fleet_geofence_v1($1::jsonb) result',
      [JSON.stringify(payload)],
    )).rows[0].result;
  } finally {
    await db.exec('reset role');
  }
}

describe('canonical fleet geofence commands', () => {
  it('toggles through an exact-replay command and records the audit ledger', async () => {
    const payload = {
      tenant_id: ids.tenant,
      request_id: ids.toggleRequest,
      geofence_id: ids.fleet,
      action: 'set_enabled',
      enabled: false,
    };
    const first = await call(payload);
    const replay = await call(payload);

    expect(replay).toEqual(first);
    expect((await db.query('select enabled from public.geofences where id=$1', [ids.fleet])).rows[0])
      .toEqual({ enabled: false });
    expect((await db.query('select action,entity_id from public.operator_command_ledger')).rows[0])
      .toEqual({ action: 'mutate_fleet_geofence', entity_id: ids.fleet });
  });

  it('deletes only fleet geofences and safely replays after the row is gone', async () => {
    const payload = {
      tenant_id: ids.tenant,
      request_id: ids.deleteRequest,
      geofence_id: ids.fleet,
      action: 'delete',
    };
    const first = await call(payload);
    expect(await call(payload)).toEqual(first);
    expect((await db.query('select count(*)::int count from public.geofences where id=$1', [ids.fleet])).rows[0])
      .toEqual({ count: 0 });

    await expect(call({ ...payload, request_id: crypto.randomUUID(), geofence_id: ids.delivery }))
      .rejects.toThrow(/fleet_geofence_not_found/);
  });

  it('rejects cross-tenant commands and all direct authenticated writes', async () => {
    await expect(call({
      tenant_id: ids.otherTenant,
      request_id: crypto.randomUUID(),
      geofence_id: ids.fleet,
      action: 'delete',
    })).rejects.toThrow(/not_authorized/);

    await db.exec('set role authenticated');
    await expect(db.query('update public.geofences set enabled=false where id=$1', [ids.fleet]))
      .rejects.toThrow(/permission denied/);
    await expect(db.query('delete from public.geofences where id=$1', [ids.fleet]))
      .rejects.toThrow(/permission denied/);
    expect((await db.query('select name from public.geofences order by name')).rows).toEqual([
      { name: 'Entrega' },
      { name: 'Garagem' },
    ]);
    await db.exec('reset role');
  });
});
