// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260901212053_revoke_replaced_dispatch_planner_acl.sql',
), 'utf8');
const baseline = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260824224152_baseline.sql',
), 'utf8');
const target = 'plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)';
const canonical = [
  'dispatch_planned_route(jsonb)',
  'plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb)',
] as const;

const targetDefinition = baseline.match(
  /CREATE OR REPLACE FUNCTION public\.plan_dispatch_trip_v2\(p_tenant_id uuid, p_driver_id uuid,[\s\S]*?\$function\$;\r?\n/,
)?.[0].replace(/\r\n/g, '\n');

const runtimeFiles = (root: string): string[] => readdirSync(root).flatMap((entry) => {
  const path = join(root, entry);
  if (path.includes(join('src', 'test')) || path.includes(join('src', 'integrations', 'supabase', 'types.ts'))) return [];
  if (statSync(path).isDirectory()) return runtimeFiles(path);
  return /\.(ts|tsx)$/.test(path) ? [path] : [];
});

const runtimeSource = [join(process.cwd(), 'src'), join(process.cwd(), 'supabase/functions')]
  .flatMap(runtimeFiles)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists public;
  `);
  if (!targetDefinition) throw new Error('baseline dispatch planner definition not found');
  await db.exec(targetDefinition);
  await db.exec(`
    revoke all on function public.${target} from public, anon, authenticated, service_role;
    grant execute on function public.${target} to authenticated, service_role;

    create function public.dispatch_planned_route(payload jsonb) returns uuid
      language sql set search_path='' as $$select null::uuid$$;
    create function public.plan_dispatch_trip_v3(
      tenant_id uuid, request_id text, driver_id uuid, vehicle_id uuid,
      route_name text, load_ids uuid[], stops jsonb
    ) returns uuid language sql set search_path='' as $$select null::uuid$$;
    revoke all on function public.dispatch_planned_route(jsonb),
      public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb)
      from public, anon, authenticated, service_role;
    grant execute on function public.dispatch_planned_route(jsonb),
      public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb)
      to authenticated, service_role;
  `);
  return db;
}

describe('replaced dispatch planner ACL closure', () => {
  it('revokes only the exact v2 browser surface and preserves service/canonical access', async () => {
    const db = await database();
    try {
      await db.exec(migration);
      const result = await db.query<{
        anon: boolean;
        authenticated: boolean;
        service: boolean;
      }>(`
        select
          has_function_privilege('anon','public.${target}','execute') anon,
          has_function_privilege('authenticated','public.${target}','execute') authenticated,
          has_function_privilege('service_role','public.${target}','execute') service
      `);
      expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true });

      for (const signature of canonical) {
        const allowed = await db.query<{ allowed: boolean }>(`
          select has_function_privilege(
            'authenticated', 'public.${signature}', 'execute'
          ) allowed
        `);
        expect(allowed.rows[0].allowed, signature).toBe(true);
      }
    } finally {
      await db.close();
    }
  });

  it('fails before revocation when a canonical replacement is unavailable', async () => {
    const db = await database();
    try {
      await db.exec('drop function public.dispatch_planned_route(jsonb)');
      await expect(db.exec(migration)).rejects.toThrow('Canonical dispatch planner is not ready');
      const result = await db.query<{ allowed: boolean }>(`
        select has_function_privilege(
          'authenticated', 'public.${target}', 'execute'
        ) allowed
      `);
      expect(result.rows[0].allowed).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('fails before revocation when the legacy implementation drifted', async () => {
    const db = await database();
    try {
      await db.exec(`
        create or replace function public.plan_dispatch_trip_v2(
          p_tenant_id uuid, p_driver_id uuid, p_vehicle_id uuid,
          p_route_name text, p_load_ids uuid[], p_stops jsonb,
          p_idempotency_key text default null
        ) returns uuid language plpgsql security definer set search_path=public
          as $$begin return null; end$$
      `);
      await expect(db.exec(migration)).rejects.toThrow('Legacy dispatch planner changed');
      const result = await db.query<{ allowed: boolean }>(`
        select has_function_privilege(
          'authenticated', 'public.${target}', 'execute'
        ) allowed
      `);
      expect(result.rows[0].allowed).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('is explicit and has no runtime caller in the repository', () => {
    expect(migration).toContain('14a016666f3beecff0b49e7b30b12632');
    expect(migration).toContain('public.plan_dispatch_trip_v2(');
    expect(migration).not.toMatch(/all functions in schema|alter default privileges|for\s+routine\s+in/i);
    expect(migration).not.toMatch(/revoke[^;]+plan_dispatch_trip_v3/i);
    expect(migration).not.toMatch(/revoke[^;]+dispatch_planned_route/i);
    expect(runtimeSource).not.toMatch(/\.rpc\s*\(\s*['"]plan_dispatch_trip_v2['"]/);
  });
});
