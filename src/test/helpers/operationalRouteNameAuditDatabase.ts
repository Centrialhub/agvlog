import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { id, request, setup } from './assignedIncidentPersonnelFixture';

export const ids = id;
export const routeId = '36000000-0000-4000-8000-000000000001';
export const peerRouteId = '36000000-0000-4000-8000-000000000002';
export const initialRevision = '2026-01-01T00:00:00Z';
export const nextRevision = '2026-01-02T00:00:00Z';
const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8').replace(/\r\n/g, '\n');
export const forward = readFileSync('supabase/migrations/20261006124418_restore_operational_route_name_audit.sql', 'utf8');
export const rollback = readFileSync('docs/qa/operational-route-name-audit-rollback-2026-10-06.sql', 'utf8');

export function actualFunction(name: string) {
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  const end = baseline.indexOf('$function$;', start) + 11;
  if (start < 0 || end < 11) throw new Error('Missing baseline function ' + name);
  return baseline.slice(start, end);
}

/** In-memory PostgreSQL: actual legacy trigger/writer/schema/policies and captured native auth helpers.
 * Table grants and records are synthetic; this is not the native restored database or GoTrue. */
export async function createRouteNameAuditDatabase() {
  const db = await setup();
  try {
  for (const table of ['operational_routes', 'entity_audit_log']) {
    const declaration = baseline.match(new RegExp('CREATE TABLE public\\.' + table + ' \\([\\s\\S]*?\\n\\);'))?.[0];
    if (!declaration) throw new Error('Missing actual table ' + table);
    await db.exec(declaration);
    const defaults = baseline.match(new RegExp('ALTER TABLE ONLY public\\.' + table + '\\n {4}ALTER COLUMN[\\s\\S]*?;'))?.[0];
    if (!defaults) throw new Error('Missing actual defaults ' + table);
    await db.exec(defaults);
    await db.exec(`alter table public.${table} add primary key(id); alter table public.${table} enable row level security;`);
  }
  for (const name of ['get_user_tenant_ids', 'op_route_norm', 'operational_routes_guard_name', '_log_entity_audit', 'operational_routes_audit_name']) {
    await db.exec(actualFunction(name));
  }
  for (const name of ['operational_routes_guard_name()', 'operational_routes_audit_name()', '_log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)']) {
    await db.exec(`revoke all on function public.${name} from public,anon,authenticated,service_role; grant execute on function public.${name} to service_role;`);
  }
  const index = baseline.match(/CREATE UNIQUE INDEX operational_routes_tenant_name_key[^;]*;/)?.[0];
  if (!index) throw new Error('Missing actual normalized name constraint');
  await db.exec(index);
  for (const name of ['trg_operational_routes_guard_name', 'trg_operational_routes_audit_name']) {
    const trigger = baseline.match(new RegExp('CREATE TRIGGER ' + name + '[^;]*;'))?.[0];
    if (!trigger) throw new Error('Missing actual trigger ' + name);
    await db.exec(trigger);
  }
  for (const policy of baseline.matchAll(/CREATE POLICY[^\n]* ON public\.(?:operational_routes|entity_audit_log) [^\n]*;/g)) {
    await db.exec(policy[0]);
  }
  await db.exec('grant select,update on public.operational_routes to authenticated; grant select,insert on public.entity_audit_log to authenticated; grant all on public.operational_routes to service_role;');
  await db.query(`insert into operational_routes(id,tenant_id,name,description,active,created_at,updated_at)
    values($1,$2,'Rota inicial','Preservar descricao',true,$3,$3),($4,$2,'Outra rota',null,true,$3,$3)`,
  [routeId, ids.tenant, initialRevision, peerRouteId]);
  return db;
  } catch (error) { await db.close(); throw error; }
}

export async function rename(db: PGlite, name = 'Rota corrigida', options: {
  actor?: string | null; expected?: string; tenant?: string; next?: string; requestTenant?: string;
  workspace?: string; role?: 'authenticated' | 'anon'; actorToStore?: string;
} = {}) {
  return request<{ id: string; name: string; updated_at: string }>(db, options.actor === undefined ? ids.admin : options.actor,
    'update public.operational_routes set name=$1,updated_at=$2,updated_by=$3 where tenant_id=$4 and id=$5 and updated_at=$6 returning id,name,updated_at::text',
    [name, options.next ?? nextRevision, options.actorToStore ?? ids.admin, options.tenant ?? ids.tenant, routeId, options.expected ?? initialRevision],
    { tenant: options.requestTenant ?? ids.tenant, workspace: options.workspace, role: options.role });
}

export async function routeSnapshot(db: PGlite) {
  return (await db.query<{ row: Record<string, unknown> }>('select to_jsonb(r) row from public.operational_routes r where id=$1', [routeId])).rows[0].row;
}
export async function auditRows(db: PGlite) {
  return (await db.query<Record<string, unknown>>('select tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,actor_role,source,request_id from public.entity_audit_log order by created_at,id')).rows;
}
export async function catalog(db: PGlite) {
  return (await db.query<{ value: { fn: Record<string, unknown>; trigger: Record<string, unknown>; stable: unknown } }>(`select jsonb_build_object(
    'fn',(select to_jsonb(p) from pg_proc p where p.oid=coalesce(to_regprocedure('public.operational_routes_audit_name()'),to_regprocedure('private.operational_routes_audit_name()'))),
    'trigger',(select to_jsonb(t) from pg_trigger t where t.tgrelid='public.operational_routes'::regclass and t.tgname='trg_operational_routes_audit_name'),
    'stable',jsonb_build_object(
      'classes',(select jsonb_agg(to_jsonb(c) order by oid) from pg_class c where oid in('public.operational_routes'::regclass,'public.entity_audit_log'::regclass)),
      'columns',(select jsonb_agg(to_jsonb(a) order by attrelid,attnum) from pg_attribute a where attrelid in('public.operational_routes'::regclass,'public.entity_audit_log'::regclass)),
      'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid in('public.operational_routes'::regclass,'public.entity_audit_log'::regclass)),
      'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_constraint c where conrelid in('public.operational_routes'::regclass,'public.entity_audit_log'::regclass)),
      'helpers',(select jsonb_agg(to_jsonb(p) order by oid) from pg_proc p where p.oid in(to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)'),to_regprocedure('public.operational_routes_guard_name()'),to_regprocedure('private.is_request_tenant_member(uuid)'))),
      'schemas',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n where nspname in('public','private'))
    )) value`)).rows[0].value;
}
