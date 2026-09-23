// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOperatorReferencePaginationDatabase,
  operatorReferenceIds as ids,
} from './helpers/operatorReferencePaginationDatabase';

const routeId = '36000000-0000-4000-8000-000000000001';
let db: PGlite;
let revision: string;
let requestId: string;

async function remove(expected: string = revision, tenant = ids.tenant, request = requestId) {
  return db.query<{ result: { id: string; deleted_revision: string } }>(
    'select public.delete_operational_route_v1($1,$2,$3,$4) result',
    [tenant, routeId, expected, request],
  );
}

describe('operational route compare-and-delete command', () => {
  beforeAll(async () => {
    db = await createOperatorReferencePaginationDatabase();
    await db.exec(`
      alter table public.operational_routes
        add column description text,
        add column classification text,
        add column destinations jsonb,
        add column region_name text,
        add column periodicity_default text,
        add column created_by uuid,
        add column updated_by uuid;
      create table public.entity_audit_log(
        id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
        action text,old_data jsonb,new_data jsonb,actor_user_id uuid,actor_role text,source text,
        created_at timestamptz not null default clock_timestamp()
      );
      create table public.idempotency_keys(
        id uuid primary key default gen_random_uuid(),tenant_id uuid not null,key_value text not null,
        created_at timestamptz default clock_timestamp(),operation text,idempotency_key text,
        payload_hash text,result_id uuid,response_body jsonb,unique(tenant_id,key_value)
      );
      create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql security definer set search_path='' as $$
        insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,actor_role,source)
        values($1,$2,$3,$4,$5,$6,auth.uid(),'operator',$7)$$;
    `);
    await db.exec('grant delete on public.operational_routes to authenticated;');
    await db.exec(readFileSync('supabase/migrations/20260917135000_allow_operator_delete_operational_routes.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20260917135100_delete_operational_route_cas.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20260917135200_audit_operational_route_delete.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20260921193110_idempotent_operational_route_delete.sql', 'utf8'));
  });
  beforeEach(async () => {
    await db.exec('reset role;truncate public.operational_routes,public.tenant_memberships,public.entity_audit_log,public.idempotency_keys;');
    await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true)", [ids.tenant, ids.operator]);
    await db.query("insert into operational_routes(id,tenant_id,name,description,classification,destinations,periodicity_default,active,created_at,updated_at) values($1,$2,'Rota CAS','Regra removida','regional','[{\"name\":\"Destino QA\",\"periodicity\":\"weekly\"}]','weekly',true,'2026-01-01','2026-01-01')", [routeId, ids.tenant]);
    revision = (await db.query<{ revision: string }>('select updated_at::text revision from operational_routes where id=$1', [routeId])).rows[0].revision;
    requestId = crypto.randomUUID();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.operator]);
    await db.exec('set role authenticated');
  });
  afterEach(async () => { await db.exec('reset role'); });
  afterAll(async () => { await db.close(); });

  it('deletes only the exact visible revision', async () => {
    expect((await remove()).rows[0].result).toMatchObject({ id: routeId });
    await db.exec('reset role');
    expect((await db.query('select id from operational_routes where id=$1', [routeId])).rows).toEqual([]);
    expect((await db.query("select entity_type,action,actor_user_id,actor_role,source,old_data->>'name' name,old_data#>>'{destinations,0,name}' destination,old_data->>'periodicity_default' periodicity,new_data from entity_audit_log where entity_id=$1", [routeId])).rows[0]).toEqual({
      entity_type: 'operational_route', action: 'delete', actor_user_id: ids.operator,
      actor_role: 'operator', source: 'delete_operational_route_v1', name: 'Rota CAS',
      destination: 'Destino QA', periodicity: 'weekly', new_data: null,
    });
  });

  it('returns the stored result when the same delete is retried', async () => {
    const first = (await remove()).rows[0].result;
    const retry = (await remove()).rows[0].result;
    expect(retry).toEqual(first);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from entity_audit_log where entity_id=$1', [routeId])).rows[0]).toEqual({ count: 1 });
  });

  it('preserves a route changed after the list was read', async () => {
    await db.exec('reset role');
    await db.query("update operational_routes set updated_at='2026-01-02T00:00:00Z' where id=$1", [routeId]);
    await db.exec('set role authenticated');
    await expect(remove()).rejects.toThrow('operational_route_changed');
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from operational_routes where id=$1', [routeId])).rows[0]).toEqual({ count: 1 });
  });

  it('rejects direct deletes and cross-tenant commands', async () => {
    await expect(db.query('delete from operational_routes where id=$1', [routeId])).rejects.toThrow(/permission denied/);
    await expect(remove(revision, ids.otherTenant)).rejects.toThrow('operational_route_delete_not_authorized');
  });
});
