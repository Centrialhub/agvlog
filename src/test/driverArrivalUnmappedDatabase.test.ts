// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('records unmapped arrival with honest GPS evidence and preserves replay and mapped geofencing',async()=>{
 const db=new PGlite();try{
 await db.exec(`
 create schema auth;create schema private;create schema extensions;
 create function auth.uid() returns uuid language sql as $$ select '10000000-0000-4000-8000-000000000003'::uuid $$;
 create table dispatch_stops(id uuid primary key,dispatch_trip_id uuid,tenant_id uuid,status text,latitude double precision,longitude double precision,actual_arrival_at timestamptz,updated_at timestamptz);
 create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text,actual_start_at timestamptz);
 create table dispatch_events(id uuid default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,payload jsonb,created_by uuid,event_at timestamptz default now());
 create table drivers(id uuid,tenant_id uuid,user_id uuid,active boolean);
 insert into drivers values('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',true);
 create function private.require_driver_operation_membership_v1(uuid) returns void language sql as $$select$$;
 create function public._assert_driver_owns_trip(uuid) returns void language sql as $$select$$;
 create function public.stop_terminal_statuses() returns text[] language sql as $$select array['delivered','returned','refused']$$;
 create domain extensions.geography as point;
 create function extensions.st_makepoint(double precision,double precision) returns point language sql as $$select point($1,$2)$$;
 create function extensions.st_setsrid(point,integer) returns point language sql as $$select $1$$;
 create function extensions.st_distance(extensions.geography,extensions.geography) returns double precision language sql as $$select ($1::point <-> $2::point)*111000$$;
 insert into dispatch_trips values('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','in_transit',now());
 insert into dispatch_stops(id,dispatch_trip_id,tenant_id,status) values('82000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','pending');
 `);
 await db.exec(readFileSync('docs/qa/driver-arrival-unmapped-rollback.sql','utf8'));
 const call=`select driver_mark_arrival('82000000-0000-4000-8000-000000000001',-15.802,-43.313,20) id`;
 await expect(db.query(call)).rejects.toThrow('sem coordenadas');
 await db.exec(readFileSync('supabase/migrations/20261127210105_driver_arrival_unmapped_destination.sql','utf8'));
 const a=await db.query(call),b=await db.query(call);expect(a.rows).toEqual(b.rows);
 const events=await db.query<{payload:{geofence_verified:boolean;location_verification:string}}>('select payload from dispatch_events');
 expect(events.rows).toHaveLength(1);expect(events.rows[0].payload).toMatchObject({geofence_verified:false,location_verification:'driver_gps_unverified_destination'});
 await db.exec(`update dispatch_stops set status='pending',actual_arrival_at=null,latitude=-20,longitude=-47`);
 await expect(db.query(call)).rejects.toThrow('fora do raio');
 }finally{await db.close();}
});
