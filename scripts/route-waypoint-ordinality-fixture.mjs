import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
export const routePatch = migration('20260928183948_fix_route_template_waypoint_ordinality.sql');
export const routeSignatures = ['finance_private.save_route_template_unsafe_20260917(jsonb)', 'public.save_route_template_v1(jsonb)'];
export const ids = Object.fromEntries(['tenant','foreignTenant','admin','foreignAdmin','operator','poi','foreignPoi',
  'geofence','foreignGeofence','foreignRoute','request','updateRequest','staleRequest'].map((key,index) =>
  [key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));

function completeFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Historical function missing: ${marker}`);
  const text = source.slice(start);
  const delimiter = /\bas\s+(\$[a-zA-Z0-9_]*\$)/i.exec(text);
  if (!delimiter) throw new Error('Function delimiter missing');
  const end = text.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error('Function end missing');
  return text.slice(0, end + delimiter[1].length + 1);
}

// Full route helper and public wrapper from the reviewed, restored schema capture.
// The shared reference helper is extracted from its historical definition.
// Minimal relational/membership fixture: no production data or network, and no
// claim of full Supabase RLS or concurrent multi-session validation.
export async function createRouteOrdinalityDatabase() {
  const db = new PGlite();
  const baseline = migration('20260824224152_baseline.sql');
  const enumSql = baseline.match(/CREATE TYPE public\.waypoint_type AS ENUM \([^;]+;/)?.[0];
  if (!enumSql) throw new Error('Historical waypoint enum missing');
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA finance_private;
    CREATE TABLE public.qa_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_tenant_admin(tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM public.qa_memberships WHERE tenant_id=tenant AND user_id=auth.uid() AND role='admin' AND active) $$;
    GRANT USAGE ON SCHEMA public,auth,finance_private TO authenticated;
    ${enumSql}
    CREATE TABLE public.geofences(id uuid PRIMARY KEY,tenant_id uuid);
    CREATE TABLE public.pois(id uuid PRIMARY KEY,tenant_id uuid);
    CREATE TABLE public.route_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text,
      corridor_geofence_id uuid,corridor_inside_ratio_threshold numeric,allowed_outside_minutes integer,
      route_speed_limit_kmh integer,enabled boolean);
    CREATE TABLE public.route_waypoints(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,route_id uuid,
      waypoint_order integer,waypoint_type public.waypoint_type NOT NULL DEFAULT 'checkpoint'::public.waypoint_type,
      label text,address text,poi_id uuid,geofence_id uuid,estimated_duration_min integer,notes text,
      lat double precision,lng double precision);
    INSERT INTO public.qa_memberships VALUES ('${ids.tenant}','${ids.admin}','admin',true),
      ('${ids.foreignTenant}','${ids.foreignAdmin}','admin',true),('${ids.tenant}','${ids.operator}','operator',true);
    INSERT INTO public.geofences VALUES('${ids.geofence}','${ids.tenant}'),('${ids.foreignGeofence}','${ids.foreignTenant}');
    INSERT INTO public.pois VALUES('${ids.poi}','${ids.tenant}'),('${ids.foreignPoi}','${ids.foreignTenant}');
  `);
  const revisionSql = migration('20260917144800_guard_route_template_revision.sql');
  await db.exec(revisionSql.slice(0, revisionSql.indexOf('create or replace function')));
  await db.exec(readFileSync(new URL('./fixtures/route-helper-captured-2026-09-28.sql', import.meta.url), 'utf8'));
  const atomic = migration('20260917044500_idempotent_atomic_commands.sql');
  const ledgerEnd = atomic.indexOf('\nalter function');
  if (ledgerEnd < 0) throw new Error('Historical atomic ledger definition missing');
  await db.exec(atomic.slice(0, ledgerEnd));
  await db.exec(completeFunction(migration('20260917043000_fix_live_queue_integrity.sql'), 'create function finance_private.assert_tenant_reference('));
  await db.exec(readFileSync(new URL('./fixtures/route-wrapper-captured-2026-09-28.sql', import.meta.url), 'utf8'));
  await db.exec(`REVOKE ALL ON FUNCTION finance_private.save_route_template_unsafe_20260917(jsonb) FROM PUBLIC,anon,authenticated,service_role;`);
  await db.exec(`REVOKE ALL ON FUNCTION public.save_route_template_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION public.save_route_template_v1(jsonb) TO authenticated;
    INSERT INTO public.route_templates(id,tenant_id,name,revision) VALUES('${ids.foreignRoute}','${ids.foreignTenant}','Foreign route',1);
    INSERT INTO public.route_waypoints(tenant_id,route_id,label,waypoint_order) VALUES('${ids.foreignTenant}','${ids.foreignRoute}','Foreign waypoint',0);`);
  return db;
}
