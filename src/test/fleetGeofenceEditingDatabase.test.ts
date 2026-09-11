// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260910194846_harden_fleet_geofence_editing.sql', 'utf8');
const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  fleet: '84000000-0000-4000-8000-000000000001',
  delivery: '84000000-0000-4000-8000-000000000002',
  stop: '82000000-0000-4000-8000-000000000001',
};
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
    grant usage on schema auth to authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select '10000000-0000-4000-8000-000000000001'::uuid$$;
    create function public.is_tenant_admin(uuid) returns boolean language sql stable as $$select true$$;
    create table public.geofence_radius_policies(tenant_id uuid,scope_kind text,category text,radius_m double precision,
      enter_margin_m double precision,exit_margin_m double precision,transition_confirmations integer);
    create table public.geofences(id uuid primary key,tenant_id uuid,name text,category text,enabled boolean,
      scope_kind text,dispatch_stop_id uuid,radius_policy_key text);
    grant all on public.geofences,public.geofence_radius_policies to authenticated,service_role;
    create function public.upsert_geofence_v2(_payload jsonb) returns uuid language plpgsql security invoker as $$
    declare v_id uuid:=coalesce(nullif(_payload->>'id','')::uuid,gen_random_uuid());begin
      insert into public.geofences(id,tenant_id,name,category,enabled,scope_kind,dispatch_stop_id)
      values(v_id,(_payload->>'tenant_id')::uuid,_payload->>'name',_payload->>'category',true,
        coalesce(_payload->>'scope_kind','fleet'),nullif(_payload->>'dispatch_stop_id','')::uuid)
      on conflict(id) do update set name=excluded.name,category=excluded.category;return v_id;end$$;
    create function public.upsert_geofence_v3(jsonb) returns uuid language sql as $$select null::uuid$$;
    grant execute on function public.upsert_geofence_v2(jsonb) to authenticated,service_role;
  `);
  await db.exec(migration);
});

beforeEach(async () => {
  await db.exec('reset role;truncate public.geofences,public.geofence_radius_policies');
  await db.query(`insert into public.geofences values
    ($1,$3,'Garagem','base',true,'fleet',null,'fleet:base'),
    ($2,$3,'Entrega','delivery',true,'delivery',$4,'delivery:delivery')`,
  [ids.fleet, ids.delivery, ids.tenant, ids.stop]);
});
afterAll(async () => { await db?.close(); });

const payload = (id: string) => JSON.stringify({ id, tenant_id: ids.tenant, name: 'Editada', category: 'base',
  scope_kind: 'fleet', source_kind: 'map_selected', center_lat: -23.55, center_lng: -46.63, radius_m: 300 });

describe('fleet geofence write boundary', () => {
  it('updates a fleet geofence through the canonical RPC', async () => {
    await db.exec('set role authenticated');
    await db.query('select public.upsert_geofence_v3($1::jsonb)', [payload(ids.fleet)]);
    await db.exec('reset role');
    expect((await db.query('select name,scope_kind,dispatch_stop_id from public.geofences where id=$1', [ids.fleet])).rows[0])
      .toEqual({ name: 'Editada', scope_kind: 'fleet', dispatch_stop_id: null });
  });

  it('cannot convert or delete an automatic delivery geofence as an authenticated operator', async () => {
    await db.exec('set role authenticated');
    await expect(db.query('select public.upsert_geofence_v3($1::jsonb)', [payload(ids.delivery)]))
      .rejects.toThrow(/delivery_geofences_are_read_only/);
    await expect(db.query('delete from public.geofences where id=$1', [ids.delivery]))
      .rejects.toThrow(/delivery_geofences_are_read_only/);
    await db.exec('reset role');
  });

  it('keeps the service role path available for automatic lifecycle synchronization', async () => {
    await db.exec('set role service_role');
    await db.query('delete from public.geofences where id=$1', [ids.delivery]);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from public.geofences where id=$1', [ids.delivery])).rows[0])
      .toEqual({ count: 0 });
  });
});
