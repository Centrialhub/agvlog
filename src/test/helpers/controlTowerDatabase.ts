import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8');
export const towerMigration = '20260831021458_reconcile_control_tower_read_contracts.sql';
export const towerSql = () => readFileSync('supabase/migrations/' + towerMigration, 'utf8');
export const towerAtomicSql = () => readFileSync('supabase/migrations/20260831024934_make_control_tower_evaluation_atomic.sql','utf8');
export const towerRouteSql = () => readFileSync('supabase/migrations/20260831112949_make_trip_route_calculation_recoverable.sql','utf8');
export const towerRouteFinanceSql = () => readFileSync('supabase/migrations/20260831114316_separate_planned_and_remaining_route_distance.sql','utf8');
export const towerIds = {
  tenant: '20000000-0000-4000-8000-000000000001', other: '20000000-0000-4000-8000-000000000002',
  actor: '10000000-0000-4000-8000-000000000001',
  trip: '80000000-0000-4000-8000-000000000001', planned: '80000000-0000-4000-8000-000000000002',
  vehicle: '50000000-0000-4000-8000-000000000001', driver: '60000000-0000-4000-8000-000000000001',
  load: '70000000-0000-4000-8000-000000000001', stop: '82000000-0000-4000-8000-000000000001',
};
export function towerFunction(sql: string, name: string) {
  const start = sql.toLowerCase().indexOf('create or replace function public.' + name + '(');
  const end = sql.indexOf('$function$;', start) + 11;
  if (start < 0 || end < 11) throw new Error('Missing actual function ' + name);
  return sql.slice(start, end);
}

// Actual baseline columns/defaults and internal-reader RLS, plus release MFA
// helpers. This fixture does not simulate Supabase Auth, PostGIS or all writers.
export async function controlTowerDatabase(candidate = true) {
  const db = new PGlite();
  try {await prepareControlTowerDatabase(db,candidate);return db;}
  catch(error){await db.close();throw error;}
}
export async function prepareControlTowerDatabase(db: Pick<PGlite,'exec'>,candidate=true,createRoles=true) {
  if(createRoles) await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(`
    create schema auth;grant usage on schema auth to authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;`);
  for (const name of ['app_role', 'operation_type']) {
    const ddl = baseline.match(new RegExp('CREATE TYPE public\\.' + name + ' AS ENUM[\\s\\S]*?;'))?.[0];
    if (!ddl) throw new Error('Missing enum ' + name); await db.exec(ddl);
  }
  const tables = ['tenant_memberships', 'tenant_feature_policy', 'dispatch_trips', 'dispatch_stops',
    'dispatch_trip_loads', 'loads', 'load_items', 'vehicles', 'drivers', 'positions_last',
    'trip_routes', 'trip_alerts', 'trip_live_status','positions_raw','driver_settlements','driver_settlement_events'];
  for (const name of tables) {
    const ddl = baseline.match(new RegExp('CREATE TABLE public\\.' + name + ' \\([\\s\\S]*?\\n\\);'))?.[0];
    if (!ddl) throw new Error('Missing table ' + name); await db.exec(ddl);
    const defaults = baseline.match(new RegExp('ALTER TABLE ONLY public\\.' + name + '\\s+ALTER COLUMN[\\s\\S]*?;', 'g')) ?? [];
    for (const sql of defaults) await db.exec(sql);
    for (const sql of baseline.match(new RegExp('ALTER TABLE ONLY public\\.'+name+'\\s+ADD CONSTRAINT[\\s\\S]*?;','g'))??[]) {
      if (/PRIMARY KEY|UNIQUE /.test(sql) && !/FOREIGN KEY/.test(sql)) await db.exec(sql);
    }
    if (name !== 'tenant_memberships') await db.exec(`grant select on public.${name} to authenticated;alter table public.${name} enable row level security;`);
  }
  const mfa = readFileSync('supabase/migrations/20260828210458_enforce_privileged_mfa_release.sql', 'utf8');
  for (const name of ['get_user_tenant_ids', 'has_tenant_role', 'is_tenant_member', 'is_tenant_admin',
    'is_tenant_operator_or_admin', 'is_user_internal_role']) await db.exec(towerFunction(mfa, name));
  await db.exec(towerFunction(baseline, 'stop_terminal_statuses'));
  // Actual route side effects, including the financial invalidation/audit trigger.
  for(const name of ['update_updated_at_column','_log_settlement_event','mark_driver_settlement_outdated','_tg_mark_outdated_trip_routes']){
    await db.exec(towerFunction(baseline,name));
  }
  for(const name of ['trg_trip_routes_outdate','trg_trip_routes_updated_at']){
    const ddl=baseline.match(new RegExp('CREATE TRIGGER '+name+'[\\s\\S]*?;'))?.[0];
    if(!ddl)throw new Error('Missing actual route trigger '+name);await db.exec(ddl);
  }
  for (const policy of baseline.match(/CREATE POLICY[\s\S]*?;/g) ?? []) {
    const table = policy.match(/ON public\.(\w+) /)?.[1];
    if (table && tables.includes(table) && table !== 'tenant_memberships' &&
      !/driver_owns_trip|driver_can_access_vehicle|_driver_|Drivers|_select_driver|_select_self/.test(policy)) await db.exec(policy);
  }
  for (const name of ['get_active_trips_live', 'get_open_trip_alerts']) {
    await db.exec(towerFunction(baseline, name));
    await db.exec(`revoke all on function public.${name}(uuid) from public,anon;grant execute on function public.${name}(uuid) to authenticated;`);
  }
  if (candidate) {await db.exec(towerSql());await db.exec(towerAtomicSql());await db.exec(towerRouteSql());
    // The builder is tested on the complete financial fixture, not faked here.
    await db.exec(towerRouteFinanceSql().split('-- FULL FINANCIAL BUILDER')[0]+'commit;');}
}

export async function seedTower(db: PGlite) {
  const i = towerIds;
  await db.query('insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,$3)', [i.tenant, i.actor, 'operator']);
  await db.query('insert into vehicles(id,tenant_id,plate) values($1,$2,$3)', [i.vehicle, i.tenant, 'QA-1234']);
  await db.query('insert into drivers(id,tenant_id,name,user_id) values($1,$2,$3,$4)', [i.driver, i.tenant, 'Motorista QA', i.actor]);
  await db.query("insert into loads(id,tenant_id,load_number,status,total_weight_kg) values($1,$2,'1003','in_transit',120)", [i.load, i.tenant]);
  await db.query("insert into dispatch_trips(id,tenant_id,vehicle_id,driver_id,status,actual_start_at) values($1,$2,$3,$4,'in_transit',now())", [i.trip, i.tenant, i.vehicle, i.driver]);
  await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'planned')", [i.planned, i.tenant]);
  await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)', [i.tenant, i.trip, i.load]);
  await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,destination,status,latitude,longitude) values($1,$2,$3,1,'Cliente QA','pending',-23,-46)", [i.stop, i.tenant, i.trip]);
  await db.query("insert into tenant_feature_policy(tenant_id,feature_key,enabled) values($1,'ssx_enabled',false)", [i.tenant]);
  await towerActor(db);
}
export async function towerActor(db: PGlite, aal = 'aal1', actor = towerIds.actor) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [actor, JSON.stringify({aal})]);
}
export async function towerRead<T = unknown>(db: PGlite, name = 'get_active_trips_live', tenant = towerIds.tenant): Promise<T> {
  if (!['get_active_trips_live', 'get_open_trip_alerts'].includes(name)) throw new Error('Unknown test reader');
  await db.exec('set role authenticated');
  try {
    if (name === 'get_active_trips_live') return (await db.query<{data:T}>(`select public.${name}($1) data`, [tenant])).rows[0].data;
    return (await db.query(`select * from public.${name}($1)`, [tenant])).rows as T;
  } finally { await db.exec('reset role').catch(() => { /* Caller rolls back aborted test transactions. */ }); }
}
