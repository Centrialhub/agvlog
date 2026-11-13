// @vitest-environment node
// Real journey/checklist SQL with a partial Auth schema. Full cargo is exercised in PG17 CI.
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
let db:PGlite;
const actor='10000000-0000-4000-8000-000000000003',tenant='20000000-0000-4000-8000-000000000001';
const driver='60000000-0000-4000-8000-000000000001',trip='80000000-0000-4000-8000-000000000001';
const payload={schema_version:2,checklist_model:'vehicle_readiness_v1',checked_items:[0,1,2,3,4,5],total_items:6,
 answers:[true,false,true,true,true,true],expected_boundary_id:null,expected_checklist_id:null,has_vehicle_issues:false};
const save=(value:unknown)=>db.query<{id:string}>('select public.driver_save_checklist($1,$2,$3::jsonb) id',[trip,'pre',JSON.stringify(value)]);
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
 create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text);
 create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid);
 create table public.dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,
 dispatch_stop_id uuid,event_type text,payload jsonb default '{}',notes text,created_by uuid default auth.uid(),event_at timestamptz default clock_timestamp(),created_at timestamptz default now());`);
 await db.exec(readFileSync('supabase/migrations/20260830024309_enforce_driver_journey_state_machine.sql','utf8'));
 for(const name of ['driver_create_event','driver_save_checklist'])await db.exec(readFileSync(`docs/qa/driver-readiness-rollback-2026-11-13/${name}.sql`,'utf8'));
 // Install the exact helper and first two patches. The third patch needs the full cargo schema.
 const sql=readFileSync('supabase/migrations/20261113145153_driver_vehicle_readiness_checklist.sql','utf8');
 await db.exec(sql.split('do $patch$').slice(0,3).join('do $patch$'));
},40000);
beforeEach(async()=>{
 await db.exec('reset role;truncate dispatch_events,dispatch_stops,dispatch_trips,drivers;');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 await db.query('insert into drivers values($1,$2,$3,true)',[driver,tenant,actor]);
 await db.query("insert into dispatch_trips values($1,$2,$3,'dispatched')",[trip,tenant,driver]);
});
afterAll(async()=>{await db?.close();});
it('records all six answers, derives the attention flag and qualifies a complete checklist without auto-starting a journey',async()=>{
 await save(payload);
 expect((await db.query<{payload:unknown}>('select payload from dispatch_events')).rows[0].payload).toMatchObject({answers:payload.answers,has_vehicle_issues:true,total_items:6});
 expect((await db.query('select event_type from dispatch_events')).rows).toEqual([{event_type:'checklist_pre'}]);
 await db.query("select public.driver_create_event($1,'start_shift','{}'::jsonb)",[trip]);
 expect((await db.query<{n:number}>("select count(*)::int n from dispatch_events where event_type='start_shift'")).rows[0].n).toBe(1);
});
it('rejects missing/duplicate/untyped answers and stale revisions, preserving driver and turn ownership',async()=>{
 for(const changed of [{answers:[true,null,true,true,true,true]},{checked_items:[0,1,2,3,4,4]},{schema_version:3},{total_items:8}]){
  await expect(save({...payload,...changed})).rejects.toThrow('invalid_vehicle_readiness');
 }
 await save(payload);await expect(save(payload)).rejects.toMatchObject({code:'40001'});
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['10000000-0000-4000-8000-000000000099']);
 await expect(save(payload)).rejects.toThrow();
});
it('keeps the legacy eight-item pre-check and five-item post-check contract unchanged',async()=>{
 await save({checked_items:[0,1,2,3,4,5,6,7]});
 await db.query("select public.driver_create_event($1,'start_shift','{}'::jsonb)",[trip]);
 await db.query("select public.driver_save_checklist($1,'post',$2::jsonb)",[trip,JSON.stringify({checked_items:[0,1,2,3,4]})]);
 await expect(db.query("select public.driver_create_event($1,'end_shift','{}'::jsonb)",[trip])).resolves.toHaveProperty('rows');
});
