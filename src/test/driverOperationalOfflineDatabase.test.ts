// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260910154758_driver_operational_offline_commands.sql', 'utf8');
const tenant = '20000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000003';
const driver = '60000000-0000-4000-8000-000000000001';
const trip = '80000000-0000-4000-8000-000000000001';
const stop = '82000000-0000-4000-8000-000000000001';
const request = 'a0000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select nullif(current_setting('request.tenant_id',true),'')::uuid$$;
    create table public.tenants(id uuid primary key);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid);
    create table public.test_calls(id uuid default gen_random_uuid(),command text,payload jsonb);
    create function public.driver_mark_arrival(uuid,double precision,double precision,double precision) returns uuid
      language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into public.test_calls(command) values('arrival');return v;end$$;
    create function public.driver_register_departure(uuid,text) returns uuid
      language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into public.test_calls(command) values('departure');return v;end$$;
    create function public.driver_create_event(uuid,text,jsonb,uuid,text) returns uuid
      language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into public.test_calls(command,payload) values('journey_event',$3);return v;end$$;
    create function public.driver_save_checklist(uuid,text,jsonb) returns uuid
      language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into public.test_calls(command,payload) values('checklist',$3);return v;end$$;
    create function public.driver_create_operational_occurrence(uuid,text,text,text,uuid,uuid) returns uuid
      language plpgsql as $$declare v uuid:=gen_random_uuid();begin insert into public.test_calls(command) values('occurrence');return v;end$$;
  `);
  await db.exec(migration);
  await db.query('insert into auth.users values($1)', [actor]);
  await db.query('insert into public.tenants values($1)', [tenant]);
  await db.query('insert into public.drivers values($1,$2,$3,true)', [driver, tenant, actor]);
  await db.query('insert into public.dispatch_trips values($1,$2,$3)', [trip, tenant, driver]);
  await db.query('insert into public.dispatch_stops values($1,$2,$3)', [stop, tenant, trip]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.tenant_id',$2,false)", [actor, tenant]);
}, 30_000);
afterAll(async () => { await db?.close(); });

const payload = { trip_id: trip, stop_id: stop, notes: null };
const execute = (body: {trip_id:string;stop_id:string;notes:string|null} = payload, id = request) => db.query<{ result: Record<string, unknown> }>(
  'select public.driver_apply_offline_command_v1($1,$2,$3,$4::jsonb) result',
  [tenant, id, 'departure', JSON.stringify(body)],
);
const executeCommand = (command:string,body:Record<string,unknown>,id:string) => db.query<{result:Record<string,unknown>}>(
  'select public.driver_apply_offline_command_v1($1,$2,$3,$4::jsonb) result',[tenant,id,command,JSON.stringify(body)]);

describe('driver offline command receipt executed in PostgreSQL', () => {
  it('executes once and returns the stored receipt on an identical replay', async () => {
    await db.exec('set role authenticated');
    const first = (await execute()).rows[0].result;
    const second = (await execute()).rows[0].result;
    await db.exec('reset role');
    expect(first).toMatchObject({ confirmed: true, replayed: false, request_id: request, trip_id: trip });
    expect(second).toMatchObject({ confirmed: true, replayed: true, request_id: request, entity_id: first.entity_id });
    expect((await db.query<{ count: number }>('select count(*)::int count from public.test_calls')).rows[0].count).toBe(1);
  });

  it('rejects reuse with another payload and rejects another active tenant', async () => {
    await db.exec('set role authenticated');
    await expect(execute({ ...payload, notes: 'mudou' })).rejects.toMatchObject({ code: '23505' });
    await db.exec('reset role');
    await db.query("select set_config('request.tenant_id','20000000-0000-4000-8000-000000000099',false)");
    await db.exec('set role authenticated');
    await expect(execute(payload, 'a0000000-0000-4000-8000-000000000099')).rejects.toMatchObject({ code: '42501' });
    await db.exec('reset role');
    await db.query("select set_config('request.tenant_id',$1,false)", [tenant]);
  });

  it('keeps the receipt table private and the RPC explicitly callable only by signed-in roles', async () => {
    const permissions = (await db.query(`select
      has_table_privilege('anon','public.driver_operational_command_receipts','select') anon_table,
      has_table_privilege('authenticated','public.driver_operational_command_receipts','select') auth_table,
      has_function_privilege('anon','public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)','execute') anon_rpc,
      has_function_privilege('authenticated','public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)','execute') auth_rpc,
      has_function_privilege('service_role','public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)','execute') service_rpc`)).rows[0];
    expect(permissions).toEqual({ anon_table: false, auth_table: false, anon_rpc: false, auth_rpc: true, service_rpc: true });
  });

  it('dispatches every allowlisted command and resolves an offline journey predecessor', async () => {
    await db.exec('set role authenticated');
    await executeCommand('arrival',{trip_id:trip,stop_id:stop,latitude:-15.8,longitude:-43.3,accuracy_m:10},'a0000000-0000-4000-8000-000000000010');
    await executeCommand('checklist',{trip_id:trip,kind:'pre',checklist_payload:{checked_items:[0],total_items:8}},'a0000000-0000-4000-8000-000000000011');
    await executeCommand('occurrence',{trip_id:trip,event_type:'other',description:'Ocorrência offline',severity:'low',stop_id:null,client_id:null},'a0000000-0000-4000-8000-000000000012');
    const first=await executeCommand('journey_event',{trip_id:trip,event_type:'start_shift',event_payload:{source:'driver_app',expected_previous_event_id:null}},'a0000000-0000-4000-8000-000000000013');
    await executeCommand('checklist',{trip_id:trip,kind:'post',checklist_payload:{checked_items:[0],total_items:5,
      expected_boundary_id:null,expected_boundary_request_id:'a0000000-0000-4000-8000-000000000013'}},'a0000000-0000-4000-8000-000000000015');
    await executeCommand('journey_event',{trip_id:trip,event_type:'rest',event_payload:{source:'driver_app',expected_previous_event_id:null,
      expected_previous_request_id:'a0000000-0000-4000-8000-000000000013'}},'a0000000-0000-4000-8000-000000000014');
    await db.exec('reset role');
    const calls=(await db.query<{command:string,payload:Record<string,unknown>|null}>('select command,payload from public.test_calls order by id')).rows;
    expect(calls.map(row=>row.command)).toEqual(expect.arrayContaining(['arrival','departure','checklist','occurrence','journey_event']));
    const secondJourney=calls.find(row=>row.command==='journey_event'&&row.payload?.client_event_id==='a0000000-0000-4000-8000-000000000014');
    expect(secondJourney?.payload).toMatchObject({expected_previous_event_id:first.rows[0].result.entity_id,
      client_event_id:'a0000000-0000-4000-8000-000000000014'});
    const chainedChecklist=calls.find(row=>row.command==='checklist'&&row.payload?.total_items===5);
    expect(chainedChecklist?.payload).toMatchObject({expected_boundary_id:first.rows[0].result.entity_id});
    expect(chainedChecklist?.payload).not.toHaveProperty('expected_boundary_request_id');
  });
});
