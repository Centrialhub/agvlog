// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260910182454_auto_arrive_driver_stop_from_delivery_geofence.sql','utf8');
const hardening=readFileSync('supabase/migrations/20260910190950_harden_geofence_tracking_completion.sql','utf8');
const recovery=hardening.slice(
  hardening.indexOf('-- BEGIN_TESTABLE_NEXT_STOP_RECOVERY')+'-- BEGIN_TESTABLE_NEXT_STOP_RECOVERY'.length,
  hardening.indexOf('-- END_TESTABLE_NEXT_STOP_RECOVERY'),
);
const ids={tenant:'20000000-0000-4000-8000-000000000001',vehicle:'61000000-0000-4000-8000-000000000001',
  otherVehicle:'61000000-0000-4000-8000-000000000002',trip:'80000000-0000-4000-8000-000000000001',
  stop1:'82000000-0000-4000-8000-000000000001',stop2:'82000000-0000-4000-8000-000000000002',
  fence1:'84000000-0000-4000-8000-000000000001',fence2:'84000000-0000-4000-8000-000000000002'};
let db:PGlite;

async function geofenceEvent(id:string,vehicle:string,fence:string,direction='enter'){
  return db.query(`insert into public.geofence_events(id,tenant_id,vehicle_id,geofence_id,direction,event_at,payload)
    values($1,$2,$3,$4,$5,'2026-09-10T18:30:00Z',$6::jsonb)`,[id,ids.tenant,vehicle,fence,direction,
    JSON.stringify({lat:-23.55,lng:-46.63,provider_payload_hash:id})]);
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;create schema private;
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,vehicle_id uuid,status text,actual_start_at timestamptz);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text,
      actual_arrival_at timestamptz,stop_order integer,updated_at timestamptz);
    create table public.geofences(id uuid primary key,tenant_id uuid,enabled boolean,scope_kind text,dispatch_stop_id uuid);
    create table public.geofence_states(tenant_id uuid,vehicle_id uuid,geofence_id uuid,is_inside boolean,last_changed_at timestamptz,
      primary key(tenant_id,vehicle_id,geofence_id));
    create table public.geofence_events(id uuid primary key,tenant_id uuid,vehicle_id uuid,geofence_id uuid,direction text,event_at timestamptz,payload jsonb);
    create table public.dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,
      dispatch_stop_id uuid,event_type text,event_at timestamptz,payload jsonb,created_by uuid);
    create function public.stop_terminal_statuses() returns text[] language sql immutable as
      $$select array['delivered','partial_delivery','returned','refused','failed','skipped','cancelled','completed']::text[]$$;
  `);
  await db.exec(migration);
  await db.exec(recovery);
});
beforeEach(async()=>{
  await db.exec('truncate public.dispatch_events,public.geofence_events,public.geofence_states,public.geofences,public.dispatch_stops,public.dispatch_trips');
  await db.query(`insert into public.dispatch_trips values($1,$2,$3,'in_transit',now())`,[ids.trip,ids.tenant,ids.vehicle]);
  await db.query(`insert into public.dispatch_stops values
    ($1,$3,$4,'pending',null,1,now()),($2,$3,$4,'pending',null,2,now())`,[ids.stop1,ids.stop2,ids.tenant,ids.trip]);
  await db.query(`insert into public.geofences values
    ($1,$3,true,'delivery',$4),($2,$3,true,'delivery',$5)`,[ids.fence1,ids.fence2,ids.tenant,ids.stop1,ids.stop2]);
});
afterAll(async()=>{await db?.close();});

describe('automatic arrival from a delivery geofence',()=>{
  it('advances only the next unfinished stop and records the SSX evidence',async()=>{
    await geofenceEvent('85000000-0000-4000-8000-000000000001',ids.vehicle,ids.fence2);
    expect((await db.query('select status from public.dispatch_stops where id=$1',[ids.stop2])).rows[0]).toEqual({status:'pending'});
    await geofenceEvent('85000000-0000-4000-8000-000000000002',ids.vehicle,ids.fence1);
    expect((await db.query('select status,actual_arrival_at is not null arrived from public.dispatch_stops where id=$1',[ids.stop1])).rows[0])
      .toEqual({status:'arrived',arrived:true});
    expect((await db.query('select event_type,payload from public.dispatch_events')).rows[0]).toMatchObject({event_type:'arrival',
      payload:{source:'tracking_ssx',automatic:true,geofence_verified:true,vehicle_id:ids.vehicle}});
  });

  it('allows the following stop only after the previous stop is terminal',async()=>{
    await db.query(`update public.dispatch_stops set status='delivered' where id=$1`,[ids.stop1]);
    await geofenceEvent('85000000-0000-4000-8000-000000000003',ids.vehicle,ids.fence2);
    expect((await db.query('select status from public.dispatch_stops where id=$1',[ids.stop2])).rows[0]).toEqual({status:'arrived'});
  });

  it('recovers the next stop when its confirmed geofence state was already inside',async()=>{
    await geofenceEvent('85000000-0000-4000-8000-000000000007',ids.vehicle,ids.fence2);
    await db.query(`insert into public.geofence_states values($1,$2,$3,true,'2026-09-10T18:30:00Z')`,
      [ids.tenant,ids.vehicle,ids.fence2]);
    await db.query(`update public.dispatch_stops set status='delivered' where id=$1`,[ids.stop1]);
    expect((await db.query('select status,actual_arrival_at is not null arrived from public.dispatch_stops where id=$1',[ids.stop2])).rows[0])
      .toEqual({status:'arrived',arrived:true});
    expect((await db.query(`select payload from public.dispatch_events where dispatch_stop_id=$1`,[ids.stop2])).rows[0])
      .toMatchObject({payload:{source:'tracking_ssx',automatic:true,recovered_from_active_state:true,
        geofence_id:ids.fence2,vehicle_id:ids.vehicle,released_by_stop_id:ids.stop1}});
  });

  it('ignores exit, an unrelated vehicle and a stop already arrived',async()=>{
    await geofenceEvent('85000000-0000-4000-8000-000000000004',ids.vehicle,ids.fence1,'exit');
    await geofenceEvent('85000000-0000-4000-8000-000000000005',ids.otherVehicle,ids.fence1);
    expect((await db.query('select count(*)::int count from public.dispatch_events')).rows[0]).toEqual({count:0});
    await db.query(`update public.dispatch_stops set status='arrived',actual_arrival_at=now() where id=$1`,[ids.stop1]);
    await geofenceEvent('85000000-0000-4000-8000-000000000006',ids.vehicle,ids.fence1);
    expect((await db.query('select count(*)::int count from public.dispatch_events')).rows[0]).toEqual({count:0});
  });
});
