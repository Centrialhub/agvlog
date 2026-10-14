// @vitest-environment node
// Focused PGlite execution of real predecessors and the complete guarded forward.
// Synthetic claims and partial schema; no GoTrue/native concurrency approval.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDriverForward, id, roleQuery, setupDriverGraph } from './helpers/driverAccessDatabaseFixture';

const pins=JSON.parse(readFileSync('src/test/helpers/driverOperationalMembershipPins.json','utf8')) as Array<{
  name:string;file:string;signature:string;before:string;after:string;definer:boolean;
}>;
const migration='20261012211033_driver_operational_membership_guards.sql';
const source=(file:string)=>readFileSync(`supabase/migrations/${file}`,'utf8').replace(/\r\n/g,'\n');
function definition(file:string,name:string) {
  const sql=source(file),start=sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name.replace(/\./g,'\\.')}\\s*\\(`,'i'));
  if(start<0) throw new Error(`Missing predecessor ${name}`);
  const rest=sql.slice(start),body=rest.match(/\bas\s+(\$\w*\$)([\s\S]*?)\1\s*;/i);
  if(!body) throw new Error(`Missing body ${name}`);
  return rest.slice(0,body.index!+body[0].length).replace(/^create function/i,'create or replace function');
}
const sibling='21000000-0000-4000-8000-000000000003';
const trip='81000000-0000-4000-8000-000000000001',otherTrip='81000000-0000-4000-8000-000000000002';
const stop='82000000-0000-4000-8000-000000000001',otherStop='82000000-0000-4000-8000-000000000002';
const person='85000000-0000-4000-8000-000000000001',otherPerson='85000000-0000-4000-8000-000000000002';
const vehicle='92000000-0000-4000-8000-000000000001';
let db:PGlite;
afterEach(async()=>{await db?.close();});
async function actor(user=id.shared,tenant=id.tenant) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user,JSON.stringify({sub:user,role:'authenticated',active_tenant_id:tenant})]);
}
async function setup() {
  db=await setupDriverGraph();
  await db.exec(`
    alter table tenant_memberships add column created_at timestamptz not null default now();
    alter table workspace_memberships add column updated_at timestamptz not null default now();
    alter table client_portal_access add column created_at timestamptz not null default now();
    alter table drivers add column updated_at timestamptz not null default now();
    alter table clients add column company_name text;
    create function auth.jwt() returns jsonb language sql stable as
      $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text,
      vehicle_id uuid,load_id uuid,actual_start_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,
      status text,latitude numeric,longitude numeric,actual_arrival_at timestamptz,actual_departure_at timestamptz,updated_at timestamptz default now());
    create table public.dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text not null,payload jsonb default '{}',notes text,
      created_by uuid default auth.uid(),event_at timestamptz not null default clock_timestamp(),created_at timestamptz default now());
    create table public.loads(id uuid primary key,tenant_id uuid,driver_id uuid,trip_id uuid,on_hold boolean,
      load_number text,origin text,destination text,status text);
    create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,load_id uuid,created_at timestamptz default now());
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text,nickname text);
    create table public.workspace_person_tenant_links(workspace_id uuid,workspace_person_id uuid,tenant_id uuid,driver_id uuid);
    create table public.physical_journeys(id uuid primary key,workspace_id uuid,workspace_person_id uuid,status text,created_at timestamptz default now());
    create table public.physical_journey_trips(physical_journey_id uuid,dispatch_trip_id uuid,source_tenant_id uuid,trip_order integer);
    create table public.physical_journey_stops(physical_journey_id uuid,dispatch_stop_id uuid,source_tenant_id uuid,journey_order integer);
    create table public.trip_cargo_commands(request_id uuid primary key,tenant_id uuid,actor_id uuid,
      action text,payload_hash text,result jsonb,control_id uuid);
    create table public.trip_cargo_controls(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid);
    create table public.delivery_receipt_quality_policies(id uuid primary key,tenant_id uuid,client_id uuid,
      is_active boolean,version integer,thresholds jsonb);
  `);
  await db.query('insert into tenants values($1,$2)',[sibling,id.workspace]);
  await db.query("update tenant_memberships set active=true,role='driver' where user_id=$1",[id.shared]);
  await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[sibling,id.shared]);
  await db.query("insert into workspace_memberships(workspace_id,user_id,role,active) values($1,$3,'driver',true),($2,$3,'driver',true)",[id.workspace,id.otherWorkspace,id.shared]);
  await db.query('update drivers set user_id=$1 where id=$2',[id.shared,id.foreignDriver]);
  await db.query('update drivers set user_id=$1,tenant_id=$2 where id=$3',[id.shared,sibling,id.freeDriver]);
  await db.query(`insert into dispatch_trips(id,tenant_id,driver_id,status,vehicle_id,actual_start_at)
    values($1,$2,$3,'in_transit',$7,now()),($4,$5,$6,'in_transit',$7,now())`,[trip,id.tenant,id.sharedDriver,otherTrip,id.otherTenant,id.foreignDriver,vehicle]);
  await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values($1,$2,$3,'arrived'),($4,$5,$6,'arrived')",
    [stop,id.tenant,trip,otherStop,id.otherTenant,otherTrip]);
  await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,created_by) values($1,$2,'start_shift',$5),($3,$4,'start_shift',$5)",
    [id.tenant,trip,id.otherTenant,otherTrip,id.shared]);
  await db.query("insert into loads values($1,$2,$3,$4,false,'Synthetic A','A','B','in_transit'),($5,$6,$7,$8,false,'Synthetic B','C','D','in_transit')",
    [trip,id.tenant,id.sharedDriver,trip,otherTrip,id.otherTenant,id.foreignDriver,otherTrip]);
  await db.query('insert into workspace_person_tenant_links values($1,$2,$3,$4),($5,$6,$7,$8)',
    [id.workspace,person,id.tenant,id.sharedDriver,id.otherWorkspace,otherPerson,id.otherTenant,id.foreignDriver]);
  await db.query("insert into physical_journeys values($1,$2,$3,'active',now()),($4,$5,$6,'active',now()-interval '1 hour')",
    [trip,id.workspace,person,otherTrip,id.otherWorkspace,otherPerson]);
  await db.query('insert into physical_journey_trips values($1,$1,$2,1),($3,$3,$4,1)',[trip,id.tenant,otherTrip,id.otherTenant]);
  await db.query('insert into physical_journey_stops values($1,$2,$3,1),($4,$5,$6,1)',[trip,stop,id.tenant,otherTrip,otherStop,id.otherTenant]);
  await applyDriverForward(db);
  await db.exec(definition('20260831164442_remove_authenticator_requirement.sql','public.is_tenant_member'));
  await db.exec(definition('20260831164442_remove_authenticator_requirement.sql','public.is_tenant_operator_or_admin'));
  await db.exec(source('20260830024309_enforce_driver_journey_state_machine.sql'));
  await db.exec(source('20260910131125_active_tenant_auth_context.sql'));
  // Existing workspace foundation grant; no product ACL change in this fixture.
  await db.exec('grant usage on schema private to authenticated,service_role');
  await db.exec(source('20260910154758_driver_operational_offline_commands.sql'));
  for(const pin of pins) {
    await db.exec(definition(pin.file,pin.name));
    await db.exec(`revoke all on function ${pin.signature} from public,anon,authenticated,service_role`);
    if(!['public._assert_driver_owns_trip','public._lock_driver_journey_trip','public._lock_driver_delivery_stop','private.require_trip_cargo_actor'].includes(pin.name))
      await db.exec(`grant execute on function ${pin.signature} to authenticated`);
    expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[pin.signature])).rows[0].hash).toBe(pin.before);
  }
  // Real domain policy + real restrictive active-membership policy.
  await db.exec('alter function private._driver_trip_ids() set schema public');
  const policy=source('20260824224152_baseline.sql').match(/CREATE POLICY [^\n]+ ON public\.dispatch_events AS PERMISSIVE FOR SELECT[^\n]+;/)?.[0];
  if(!policy) throw new Error('Domain policy missing');
  await db.exec(policy);
  await db.exec('alter function public._driver_trip_ids() set schema private');
  await db.exec(source('20260910132033_enforce_active_tenant_rls.sql'));
  await db.exec('grant select on dispatch_events to authenticated');
  await actor();
}
async function revokeFixtureOperation() {
  // Expected postcondition only. No administrative mutation RPC is added by this forward.
  await db.query('update tenant_memberships m set active=false from tenants t where m.tenant_id=t.id and t.workspace_id=$1 and m.user_id=$2',[id.workspace,id.shared]);
  await db.query('update workspace_memberships set active=false where workspace_id=$1 and user_id=$2',[id.workspace,id.shared]);
}
const apply=()=>db.exec(source(migration));
const journey=(tenant=id.tenant)=>roleQuery<{value:{events:unknown[]}}>(db,'authenticated','select public.driver_get_journey_context($1) value',[tenant]);
const write=(target=trip)=>roleQuery<{value:string}>(db,'authenticated',"select public.driver_create_event($1,'operational_note','{}',null,'Synthetic note') value",[target]);
const graph=async()=> (await db.query(`select
  (select jsonb_agg(to_jsonb(m) order by id) from tenant_memberships m) memberships,
  (select jsonb_agg(to_jsonb(m) order by id) from workspace_memberships m) workspaces,
  (select jsonb_agg(to_jsonb(d) order by id) from drivers d) drivers,
  (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) identities,
  (select jsonb_agg(to_jsonb(e) order by id) from dispatch_events e) events,
  (select jsonb_agg(to_jsonb(r) order by request_id) from driver_operational_command_receipts r) receipts`)).rows;

const delta='20261012221129_revalidate_driver_membership_after_journey_lock.sql';
const applyDelta=()=>db.exec(source(delta));
async function boundaryHook(statement:string) {
  await db.exec(`create or replace function public.synthetic_after_lock_boundary() returns void language plpgsql as $hook$begin ${statement} end;$hook$;`);
  const current=(await db.query<{definition:string}>("select pg_get_functiondef('public._lock_driver_journey_trip(uuid)'::regprocedure) definition")).rows[0].definition;
  const expression=/perform pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\([\s\S]*?, 0\)\);/;
  if(!expression.test(current))throw new Error('Advisory boundary missing');
  await db.exec(current.replace(expression,'perform public.synthetic_after_lock_boundary();'));
  return current;
}
describe('post-lock tenant/membership revalidation at a synthetic boundary',()=>{
  it('reproduces the reviewed inactive-tenant gap, then denies it before returning the locked trip',async()=>{
    await setup();await apply();
    await db.query('update tenant_memberships set active=false where user_id=$1 and tenant_id=$2',[id.shared,id.otherTenant]);
    const move=`update public.dispatch_trips set tenant_id='${id.otherTenant}',driver_id='${id.foreignDriver}' where id='${trip}';`;
    const original=await boundaryHook(move);await write();
    expect((await db.query('select tenant_id from dispatch_events where dispatch_trip_id=$1 and event_type=\'operational_note\'',[trip])).rows)
      .toEqual([{tenant_id:id.otherTenant}]);
    await db.exec(original);await db.query('update dispatch_trips set tenant_id=$1,driver_id=$2 where id=$3',[id.tenant,id.sharedDriver,trip]);
    await applyDelta();await boundaryHook(move);const before=await graph();
    await expect(write()).rejects.toMatchObject({code:'42501',message:'driver_journey_context_changed'});
    expect(await graph()).toEqual(before);
    expect((await db.query('select tenant_id from dispatch_trips where id=$1',[trip])).rows).toEqual([{tenant_id:id.tenant}]);
  });
  it.each(['assignment','membership'])('denies %s change at the boundary with all effects rolled back',async variant=>{
    await setup();await apply();await applyDelta();
    await boundaryHook(variant==='assignment'
      ?`update public.dispatch_trips set driver_id='${id.legacyDriver}' where id='${trip}';`
      :`update public.tenant_memberships set active=false where tenant_id='${id.tenant}' and user_id='${id.shared}';`);
    const before=await graph();await expect(write()).rejects.toMatchObject({code:'42501'});expect(await graph()).toEqual(before);
  });
  it('rejects a changed tenant even if it is active, while a direct valid trip in the other operation still works',async()=>{
    await setup();await apply();await applyDelta();
    await boundaryHook(`update public.dispatch_trips set tenant_id='${id.otherTenant}',driver_id='${id.foreignDriver}' where id='${trip}';`);
    await expect(write()).rejects.toThrow('driver_journey_context_changed');
    await write(otherTrip);
    expect((await db.query('select tenant_id from dispatch_events where dispatch_trip_id=$1 and event_type=\'operational_note\'',[otherTrip])).rows)
      .toEqual([{tenant_id:id.otherTenant}]);
  });
  it('retains ordinary valid access and the inactive-operation denial without any adapter',async()=>{
    await setup();await apply();await applyDelta();await write();await write(otherTrip);
    await revokeFixtureOperation();await expect(write()).rejects.toMatchObject({code:'42501'});
    await expect(journey()).rejects.toMatchObject({code:'42501'});await write(otherTrip);
  });
  it('preserves metadata and helper ACL, is idempotent and rejects unknown predecessor',async()=>{
    await setup();await apply();
    const metadata=()=>db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='public._lock_driver_journey_trip(uuid)'::regprocedure");
    const before=(await metadata()).rows,data=await graph();await applyDelta();await applyDelta();
    expect((await metadata()).rows).toEqual(before);expect(await graph()).toEqual(data);
    expect((await db.query("select md5(prosrc) hash from pg_proc where oid='public._lock_driver_journey_trip(uuid)'::regprocedure")).rows)
      .toEqual([{hash:'82b1c6bb20a2135f513f813f9b15c2e8'}]);
    await boundaryHook('null;');await expect(applyDelta()).rejects.toThrow('driver_after_lock_predecessor_changed');
    for(const role of ['anon','authenticated','service_role'] as const)
      await expect(roleQuery(db,role,'select private.require_driver_operation_membership_v1($1)',[id.tenant])).rejects.toMatchObject({code:'42501'});
  });
});
