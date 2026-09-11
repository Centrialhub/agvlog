// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const workspace='30000000-0000-4000-8000-000000000001',person='31000000-0000-4000-8000-000000000001',vehicle='32000000-0000-4000-8000-000000000001';
const operator='20000000-0000-4000-8000-000000000001',driverUser='20000000-0000-4000-8000-000000000002';
const driverA='41000000-0000-4000-8000-000000000001',driverB='41000000-0000-4000-8000-000000000002';
const vehicleA='42000000-0000-4000-8000-000000000001',vehicleB='42000000-0000-4000-8000-000000000002';
const tripA='51000000-0000-4000-8000-000000000001',tripB='51000000-0000-4000-8000-000000000002';
let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
    create type public.app_role as enum('owner','admin','operator','client','driver');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create table auth.users(id uuid primary key);
    create table public.workspaces(id uuid primary key,name text not null);
    create table public.tenants(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.tenant_memberships(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,user_id uuid not null,role public.app_role not null,active boolean not null default true);
    create table public.workspace_people(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.workspace_vehicles(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.drivers(id uuid primary key,tenant_id uuid not null,user_id uuid,name text not null,active boolean not null default true,updated_at timestamptz not null default now());
    create table public.vehicles(id uuid primary key,tenant_id uuid not null,plate text not null,nickname text);
    create table public.workspace_person_tenant_links(workspace_id uuid not null,workspace_person_id uuid not null,tenant_id uuid not null,driver_id uuid,employee_id uuid);
    create table public.workspace_vehicle_tenant_links(workspace_id uuid not null,workspace_vehicle_id uuid not null,tenant_id uuid not null,vehicle_id uuid not null);
    create table public.loads(id uuid primary key,tenant_id uuid not null,load_number text not null,origin text,destination text,status text not null);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid not null,load_id uuid,driver_id uuid,vehicle_id uuid,status text not null,planned_start_at timestamptz,actual_start_at timestamptz,planned_end_at timestamptz,actual_end_at timestamptz,notes text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid not null,dispatch_trip_id uuid not null references public.dispatch_trips(id),stop_order integer not null,destination text,client_id uuid,planned_arrival_at timestamptz,actual_arrival_at timestamptz,actual_departure_at timestamptz,status text not null default 'pending',notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),estimated_departure_at timestamptz,service_time_minutes integer,delivery_window_start time,delivery_window_end time,latitude numeric,longitude numeric,risk_level text,risk_reason text);
    create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,dispatch_trip_id uuid not null,load_id uuid not null,created_at timestamptz not null default now());
    create table public.clients(id uuid primary key,tenant_id uuid not null,company_name text not null);
    insert into auth.users values('${operator}'),('${driverUser}');
    insert into public.workspaces values('${workspace}','Grupo');insert into public.tenants values('${a}','${workspace}'),('${b}','${workspace}');
    insert into public.tenant_memberships(tenant_id,user_id,role) values('${a}','${operator}','admin');
    insert into public.workspace_people values('${person}','${workspace}');insert into public.workspace_vehicles values('${vehicle}','${workspace}');
    insert into public.drivers(id,tenant_id,user_id,name,active) values('${driverA}','${a}','${driverUser}','Maria',true),('${driverB}','${b}','${driverUser}','Maria',true);
    insert into public.vehicles values('${vehicleA}','${a}','ABC1D23','Cavalo'),('${vehicleB}','${b}','ABC1D23','Cavalo');
    insert into public.workspace_person_tenant_links values('${workspace}','${person}','${a}','${driverA}',null),('${workspace}','${person}','${b}','${driverB}',null);
    insert into public.workspace_vehicle_tenant_links values('${workspace}','${vehicle}','${a}','${vehicleA}'),('${workspace}','${vehicle}','${b}','${vehicleB}');
    insert into public.dispatch_trips(id,tenant_id,driver_id,vehicle_id,status,actual_start_at) values('${tripA}','${a}','${driverA}','${vehicleA}','in_transit',now()),('${tripB}','${b}','${driverB}','${vehicleB}','planned',null);
    insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,destination,status) values(gen_random_uuid(),'${a}','${tripA}',1,'Destino A','pending'),(gen_random_uuid(),'${b}','${tripB}',1,'Destino B','pending');
  `);
  await db.exec(readFileSync('supabase/migrations/20260910134223_physical_driver_journeys.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910143355_driver_physical_journey_payload.sql','utf8'));
},30_000);
afterAll(async()=>db?.close());

describe('physical multi-company driver journeys in PostgreSQL',()=>{
  it('backfills an isolated physical journey for every legacy trip',async()=>{
    expect((await db.query('select id from public.physical_journeys')).rows).toHaveLength(2);
    expect((await db.query('select dispatch_stop_id from public.physical_journey_stops')).rows).toHaveLength(2);
  });
  it('merges compatible tenant trips without changing their legal ownership',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${operator}'`);
    let merged:string;
    try{merged=(await db.query<{id:string}>(`select public.merge_physical_journeys_v1('${a}',array['${tripA}'::uuid,'${tripB}'::uuid]) id`)).rows[0].id;}
    finally{await db.exec('reset role;reset request.jwt.claim.sub');}
    const trips=(await db.query<{source_tenant_id:string}>(`select source_tenant_id from public.physical_journey_trips where physical_journey_id='${merged}' order by trip_order`)).rows;
    expect(trips).toEqual([{source_tenant_id:a},{source_tenant_id:b}]);
    expect((await db.query('select id from public.physical_journeys')).rows).toHaveLength(1);
  });
  it('lets the driver load one journey spanning both companies without a tenant selector',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${driverUser}'`);
    try{
      const result=(await db.query<{value:{has_active_journey:boolean;driver:{name:string};trips:Array<{tenant_id:string;vehicles:{plate:string}}>;stops:Array<{tenant_id:string;destination:string}>}}>('select public.get_current_driver_journey_v1() value')).rows[0].value;
      expect(result.has_active_journey).toBe(true);
      expect(result.driver.name).toBe('Maria');
      expect(new Set(result.trips.map(item=>item.tenant_id))).toEqual(new Set([a,b]));
      expect(result.trips.every(item=>item.vehicles.plate==='ABC1D23')).toBe(true);
      expect(new Set(result.stops.map(item=>item.tenant_id))).toEqual(new Set([a,b]));
      expect(new Set(result.stops.map(item=>item.destination))).toEqual(new Set(['Destino A','Destino B']));
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
  });
  it('automatically attaches new trips and stops to a physical journey',async()=>{
    const trip='51000000-0000-4000-8000-000000000003',stop='52000000-0000-4000-8000-000000000003';
    await db.query(`insert into public.dispatch_trips(id,tenant_id,driver_id,vehicle_id,status) values('${trip}','${a}','${driverA}','${vehicleA}','planned')`);
    await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order) values('${stop}','${a}','${trip}',1)`);
    expect((await db.query(`select dispatch_stop_id from public.physical_journey_stops where physical_journey_id='${trip}'`)).rows).toEqual([{dispatch_stop_id:stop}]);
  });
});
