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
const request='91000000-0000-4000-8000-000000000001';
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

describe('operational membership guards on unchanged claims',()=>{
  it('fails before and denies after the complete migration, while another operation stays usable',async()=>{
    await setup();await revokeFixtureOperation();
    expect((await journey()).rows[0].value.events).toHaveLength(1);
    await write(); // Proven predecessor accepts a write after deactivation.
    const before=await graph();
    await apply();
    await expect(journey()).rejects.toMatchObject({code:'42501'});
    await expect(write()).rejects.toMatchObject({code:'42501'});
    expect(await graph()).toEqual(before);
    expect((await journey(id.otherTenant)).rows[0].value.events).toHaveLength(1);
    await write(otherTrip);
  });
  it('blocks direct checklist and offline new/replayed commands after deactivation without effects',async()=>{
    await setup();await apply();
    const offline=()=>roleQuery<{value:{replayed:boolean}}>(db,'authenticated',
      "select public.driver_apply_offline_command_v1($1,$2,'journey_event',$3::jsonb) value",
      [id.tenant,request,{trip_id:trip,event_type:'operational_note'}]);
    expect((await offline()).rows[0].value.replayed).toBe(false);
    expect((await offline()).rows[0].value.replayed).toBe(true);
    await revokeFixtureOperation();const before=await graph();
    await expect(offline()).rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(db,'authenticated',"select public.driver_save_checklist($1,'pre','{\"checked_items\":[]}'::jsonb)",[trip]))
      .rejects.toMatchObject({code:'42501'});
    expect(await graph()).toEqual(before);
  });
  it.each([
    ['arrival',"select public.driver_mark_arrival($1,0::double precision,0::double precision,10::double precision)",stop],
    ['departure','select public.driver_register_departure($1,null)',stop],
    ['start','select public.driver_start_trip($1)',trip],
    ['cargo',"select public.driver_update_trip_cargo_v1($2,$1,$3,'accept','{}'::jsonb)",trip],
    ['quality','select public.resolve_delivery_receipt_quality_policy_v1($1)',stop],
  ])('denies %s at the membership boundary before business effects',async(_label,sql,target)=>{
    await setup();await apply();await revokeFixtureOperation();const before=await graph();
    const params=sql.includes('$3')?[target,id.tenant,request]:[target];
    await expect(roleQuery(db,'authenticated',sql,params)).rejects.toMatchObject({code:'42501'});
    expect(await graph()).toEqual(before);
  });
  it('filters physical journeys by active operation membership without changing drivers.active or choosing a new tenant',async()=>{
    await setup();await apply();await revokeFixtureOperation();
    const denied=(await roleQuery<{value:boolean}>(db,'authenticated','select private.can_access_physical_journey($1) value',[trip])).rows[0].value;
    expect(denied).toBe(false);
    expect((await roleQuery<{value:boolean}>(db,'authenticated','select private.can_access_physical_journey($1) value',[otherTrip])).rows[0].value).toBe(true);
    const current=(await roleQuery<{value:{journey:{workspace_id:string}}}>(db,'authenticated','select public.get_current_driver_journey_v1() value')).rows[0].value;
    expect(current.journey.workspace_id).toBe(id.otherWorkspace);
    await db.query('update tenant_memberships set active=false where user_id=$1 and tenant_id=$2',[id.shared,id.otherTenant]);
    expect((await roleQuery<{value:{has_active_journey:boolean}}>(db,'authenticated','select public.get_current_driver_journey_v1() value')).rows[0].value.has_active_journey).toBe(false);
  });
  it('keeps active driver access and rejects an unrelated actor or a foreign trip in the offline scope',async()=>{
    await setup();await apply();await write();
    await expect(roleQuery(db,'authenticated',"select public.driver_apply_offline_command_v1($1,$2,'journey_event',$3::jsonb)",
      [id.tenant,request,{trip_id:otherTrip,event_type:'operational_note'}])).rejects.toMatchObject({code:'42501'});
    await actor(id.operator);await expect(write()).rejects.toMatchObject({code:'42501'});
    await expect(journey()).rejects.toMatchObject({code:'42501'});
  });
  it('revokes the driver identity/ownership RLS helpers only in the inactive operation',async()=>{
    await setup();await apply();await revokeFixtureOperation();
    expect((await roleQuery<{driver:string|null;owns:boolean;stop:boolean}>(db,'authenticated',
      'select public.current_driver_id($1) driver,public.driver_owns_trip($2) owns,private.driver_owns_stop($3) stop',
      [id.tenant,trip,stop])).rows).toEqual([{driver:null,owns:false,stop:false}]);
    expect((await roleQuery<{value:string}>(db,'authenticated','select private._driver_trip_ids() value')).rows).toEqual([{value:otherTrip}]);
    expect((await roleQuery<{value:string}>(db,'authenticated','select private._driver_load_ids() value')).rows).toEqual([{value:otherTrip}]);
    expect((await roleQuery<{driver:string|null}>(db,'authenticated','select public.current_driver_id($1) driver',[id.otherTenant])).rows)
      .toEqual([{driver:id.foreignDriver}]);
  });
  it('denies an occurrence before either operational write and preserves observability authorization',async()=>{
    await setup();await apply();await revokeFixtureOperation();const before=await graph();
    await expect(roleQuery(db,'authenticated',"select public.driver_create_operational_occurrence($1,'outros','Synthetic','low',null,null)",[trip]))
      .rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(db,'authenticated',"select public.publish_driver_app_observability_v1($1::jsonb)",
      [{version:1,tenant_id:id.tenant,installation_id:request}])).rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(db,'authenticated','select public.disable_driver_app_observability_v1($1,$2)',[id.tenant,request]))
      .rejects.toMatchObject({code:'42501'});
    expect(await graph()).toEqual(before);
  });
  it('membership guards do not newly require the driver role when an existing assigned driver has another valid role',async()=>{
    await setup();await db.query("update tenant_memberships set role='operator' where tenant_id=$1 and user_id=$2",[id.tenant,id.shared]);
    await apply();await write();expect((await journey()).rows[0].value.events).toHaveLength(1);
  });
  it('rolls back command effects, then denies a stale-session retry after deactivation',async()=>{
    await setup();await apply();const before=await graph();
    await db.exec('begin;set local role authenticated');
    await db.query("select public.driver_create_event($1,'operational_note')",[trip]);
    await db.exec('rollback');expect(await graph()).toEqual(before);
    await revokeFixtureOperation();await expect(write()).rejects.toMatchObject({code:'42501'});
  });
  it('preserves every existing function metadata/ACL, is idempotent, and exposes no new helper entry point',async()=>{
    await setup();const signatures=pins.map(p=>p.signature);
    const metadata=()=>db.query('select oid,to_jsonb(p)-\'prosrc\' value from pg_proc p where oid=any(select to_regprocedure(x) from unnest($1::text[]) x) order by oid',[signatures]);
    const before=(await metadata()).rows,data=await graph();await apply();await apply();
    expect((await metadata()).rows).toEqual(before);expect(await graph()).toEqual(data);
    for(const pin of pins) expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[pin.signature])).rows[0].hash).toBe(pin.after);
    await expect(roleQuery(db,'authenticated','select private.require_driver_operation_membership_v1($1)',[id.tenant])).rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(db,'anon','select public.driver_get_journey_context($1)',[id.tenant])).rejects.toMatchObject({code:'42501'});
  });
  it('accepts only the two exact approved CRLF predecessors and preserves ACLs, metadata, data and idempotence',async()=>{
    await setup();
    const known = new Map([
      ['public.driver_start_trip','b811d2ee48a98b44de55f86f94f77998'],
      ['private.driver_can_read_vehicle_position','943a0e187a4d30cd6ea570731c1c797d'],
    ]);
    for(const pin of pins.filter(pin=>known.has(pin.name))) {
      await db.exec(definition(pin.file,pin.name).replace(/\n/g,'\r\n'));
      expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[pin.signature])).rows[0].hash).toBe(known.get(pin.name));
    }
    const signatures=pins.map(pin=>pin.signature);
    const metadata=()=>db.query('select oid,to_jsonb(p)-\'prosrc\' value from pg_proc p where oid=any(select to_regprocedure(x) from unnest($1::text[]) x) order by oid',[signatures]);
    const before=(await metadata()).rows,data=await graph();await apply();await apply();
    expect((await metadata()).rows).toEqual(before);expect(await graph()).toEqual(data);
    for(const pin of pins) expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[pin.signature])).rows[0].hash).toBe(pin.after);
    await write();expect((await journey()).rows[0].value.events).toHaveLength(1);
  });
  it('refuses an uncaptured CRLF predecessor before any helper or body is changed',async()=>{
    await setup();const pin=pins.find(pin=>pin.name==='public._assert_driver_owns_trip')!;
    await db.exec(definition(pin.file,pin.name).replace(/\n/g,'\r\n'));
    const before=await graph();await expect(apply()).rejects.toThrow('driver_operation_predecessor_changed');
    expect(await graph()).toEqual(before);
    expect((await db.query('select to_regprocedure(\'private.require_driver_operation_membership_v1(uuid)\') value')).rows).toEqual([{value:null}]);
  });

  it('refuses predecessor drift atomically instead of patching an unknown live contract',async()=>{
    await setup();await db.exec("create or replace function public.driver_get_journey_context(_tenant_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$");
    const before=await graph();await expect(apply()).rejects.toThrow('driver_operation_predecessor_changed');
    expect(await graph()).toEqual(before);
    expect((await db.query('select to_regprocedure(\'private.require_driver_operation_membership_v1(uuid)\') value')).rows).toEqual([{value:null}]);
  });
});
