// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Real PostgreSQL/PLpgSQL execution against a minimal schema. This complements,
// but does not replace, the full Supabase pgTAP/RLS and concurrent-session suite.
const tripId = '80000000-0000-4000-8000-000000000001';
const tenantId = '20000000-0000-4000-8000-000000000001';
const driverId = '60000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000003';
const stopId = '82000000-0000-4000-8000-000000000001';
const types = ['start_shift', 'lunch', 'rest', 'overnight', 'resume', 'end_shift'];
let db: PGlite;

const record = (type: string, payload: unknown = {}, trip = tripId, stop: string | null = null) =>
  db.query('select public.driver_create_event($1::uuid, $2, $3::jsonb, $4::uuid)',
    [trip, type, JSON.stringify(payload), stop]);

const save = (kind: string | null, payload: unknown, trip = tripId) => db.query<{ driver_save_checklist: string }>(
  'select public.driver_save_checklist($1,$2,$3::jsonb)', [trip,kind,JSON.stringify(payload)]);
const complete = (kind: 'pre' | 'post', trip = tripId) => save(kind, { checked_items: kind === 'pre' ? [0,1,2,3,4,5,6,7] : [0,1,2,3,4] }, trip);

async function checklist(kind: 'pre' | 'post', checked: unknown = kind === 'pre' ? [0,1,2,3,4,5,6,7] : [0,1,2,3,4]) {
  await db.query(`insert into public.dispatch_events(tenant_id, dispatch_trip_id, event_type, payload,event_at)
    values ($1, $2, $3, $4::jsonb, greatest(clock_timestamp(),(select max(event_at) + interval '1 microsecond' from public.dispatch_events)))`,
    [tenantId, tripId, `checklist_${kind}`, JSON.stringify({ checked_items: checked })]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.drivers(id uuid primary key, tenant_id uuid, user_id uuid, active boolean);
    create table public.dispatch_trips(id uuid primary key, tenant_id uuid, driver_id uuid, status text);
    create table public.dispatch_stops(id uuid primary key, tenant_id uuid, dispatch_trip_id uuid);
    create table public.dispatch_events(
      id uuid primary key default gen_random_uuid(), tenant_id uuid, dispatch_trip_id uuid,
      dispatch_stop_id uuid, event_type text not null, payload jsonb default '{}', notes text,
      created_by uuid default auth.uid(), event_at timestamptz not null default clock_timestamp(), created_at timestamptz default now()
    );
  `);
  await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations/20260830024309_enforce_driver_journey_state_machine.sql'), 'utf8'));
}, 30000);

beforeEach(async () => {
  await db.exec(`reset role; truncate public.dispatch_events, public.dispatch_stops, public.dispatch_trips, public.drivers;`);
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', userId]);
  await db.query('insert into public.drivers values ($1,$2,$3,true)', [driverId, tenantId, userId]);
  await db.query('insert into public.dispatch_trips values ($1,$2,$3,$4)', [tripId, tenantId, driverId, 'in_transit']);
  await db.query('insert into public.dispatch_stops values ($1,$2,$3)', [stopId, tenantId, tripId]);
});

afterAll(async () => { await db?.close(); });

describe('journey RPC executed by PostgreSQL', () => {
  const allowed: Record<string, string[]> = {
    none: ['start_shift'], start_shift: ['lunch','rest','overnight','end_shift'],
    resume: ['lunch','rest','overnight','end_shift'],
    lunch: ['resume'], rest: ['resume'], overnight: ['resume'], end_shift: ['start_shift'],
  };

  it.each(Object.entries(allowed).flatMap(([previous, next]) =>
    types.map(type => ({ previous, type, valid: next.includes(type) })),
  ))('$previous -> $type is valid=$valid', async ({ previous, type, valid }) => {
    if (previous !== 'none' && previous !== 'start_shift') await db.query(`insert into public.dispatch_events
      (tenant_id,dispatch_trip_id,event_type) values ($1,$2,'start_shift')`, [tenantId,tripId]);
    if (previous !== 'none') await db.query(`insert into public.dispatch_events
      (tenant_id,dispatch_trip_id,event_type,event_at) values ($1,$2,$3,
        greatest(clock_timestamp(),(select max(event_at) + interval '1 microsecond' from public.dispatch_events)))`, [tenantId,tripId,previous]);
    await checklist('pre');
    await checklist('post');
    await db.exec('set role authenticated');
    if (valid) await expect(record(type)).resolves.toHaveProperty('rows');
    else await expect(record(type)).rejects.toMatchObject({ code: '23514' });
  });

  it('preserves event order inside one transaction even when the clock repeats', async () => {
    await checklist('pre');
    await db.exec('begin; set local role authenticated');
    try {
      for (const type of ['start_shift', 'lunch', 'resume']) await record(type);
      await db.query('select public.driver_save_checklist($1,$2,$3::jsonb)', [tripId,'post',JSON.stringify({checked_items:[0,1,2,3,4]})]);
      await record('end_shift');
      await db.exec('reset role');
      const { rows } = await db.query<{ event_type: string }>(`select event_type from public.dispatch_events
        where event_type <> 'checklist_pre' and event_type <> 'checklist_post' order by event_at, created_at, id`);
      expect(rows.map(row => row.event_type)).toEqual(['start_shift', 'lunch', 'resume', 'end_shift']);
    } finally {
      await db.exec('rollback');
    }
  });

  it.each([[], [0,1,2,3,4,5,6,6], ['999999999999999999999999999'], null, 'invalid'].map(checked => ({ checked })))(
    'rejects incomplete or malformed checklist $checked without cast overflow', async ({ checked }) => {
      await checklist('pre', checked);
      await expect(record('start_shift')).rejects.toMatchObject({ code: '23514' });
    });

  it('rejects cancellation even for the assigned driver', async () => {
    await db.query("update public.dispatch_trips set status='cancelled'");
    await expect(record('operational_note')).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects unauthenticated and foreign-driver calls', async () => {
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', '']);
    await expect(record('operational_note')).rejects.toMatchObject({ code: '42501' });
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099']);
    await expect(record('operational_note')).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects a stop outside the trip and a stop on a journey event', async () => {
    await expect(record('operational_note', {}, tripId, '82000000-0000-4000-8000-000000000099')).rejects.toMatchObject({ code: '42501' });
    await expect(record('start_shift', {}, tripId, stopId)).rejects.toMatchObject({ code: '22023' });
  });

  it('preserves informational delivery events after the final stop completes the trip', async () => {
    await db.query("update public.dispatch_trips set status='completed'");
    await expect(record('info_entrega_parcial', { photo_paths: ['tenant/photo.jpg'] }, tripId, stopId)).resolves.toHaveProperty('rows');
  });

  it.each(['arrival','trip_started','checklist_pre','unrecognized'])('rejects forged %s events', async type => {
    await expect(record(type)).rejects.toMatchObject({ code: '22023' });
  });

  it.each([[], 'string', 3, { text: 'x'.repeat(131073) }])('rejects malformed or oversized payload', async payload => {
    await expect(record('operational_note', payload)).rejects.toMatchObject({ code: '22023' });
  });

  it('does not grant the API to anonymous callers', async () => {
    await db.exec('set role anon');
    await expect(record('operational_note')).rejects.toMatchObject({ code: '42501' });
  });

  it('requires fresh pre and post checklists for every shift on the same trip', async () => {
    await complete('pre');
    await complete('post');
    await record('start_shift');
    await expect(record('end_shift')).rejects.toMatchObject({ code: '23514' });
    await complete('post');
    await record('end_shift');
    await expect(record('start_shift')).rejects.toMatchObject({ code: '23514' });
    await complete('pre');
    await record('start_shift');
    await expect(record('end_shift')).rejects.toMatchObject({ code: '23514' });
    await complete('post');
    await expect(record('end_shift')).resolves.toHaveProperty('rows');
  });

  it('preserves one personal state across two trips and supports a later shift', async () => {
    const otherTrip = '80000000-0000-4000-8000-000000000002';
    await db.query('insert into public.dispatch_trips values ($1,$2,$3,$4)', [otherTrip,tenantId,driverId,'in_transit']);
    await complete('pre');
    await record('start_shift');
    await complete('pre', otherTrip);
    await expect(record('start_shift',{},otherTrip)).rejects.toMatchObject({ code: '23514' });
    await record('lunch',{},otherTrip);
    await expect(record('end_shift')).rejects.toMatchObject({ code: '23514' });
    await record('resume',{},otherTrip);
    await complete('post',otherTrip);
    await record('end_shift',{},otherTrip);
    await complete('pre',otherTrip);
    await expect(record('start_shift',{},otherTrip)).resolves.toHaveProperty('rows');
  });

  it('closes a shift on a completed trip but never starts a new one there', async () => {
    await complete('pre'); await record('start_shift');
    await db.exec("update public.dispatch_trips set status='completed'");
    await complete('post'); await record('end_shift');
    await complete('pre');
    await expect(record('start_shift')).rejects.toMatchObject({ code: '23514' });
  });

  it('deduplicates retries but rejects a key reused for different content', async () => {
    await complete('pre');
    const payload = { client_event_id: '90000000-0000-4000-8000-000000000001', expected_previous_event_id: null, source: 'driver_app' };
    const first = await record('start_shift', payload);
    await record('lunch');
    expect((await record('start_shift',payload)).rows).toEqual(first.rows);
    await expect(record('start_shift',{...payload,source:'changed'})).rejects.toMatchObject({code:'23505'});
    await expect(record('resume',payload)).rejects.toMatchObject({code:'23505'});
  });

  it('rejects stale state even when the requested action is otherwise valid', async () => {
    await complete('pre'); await record('start_shift');
    await expect(record('lunch',{expected_previous_event_id:null})).rejects.toMatchObject({code:'40001'});
  });

  it('accepts partial checklists, canonicalizes order and detects stale revisions', async () => {
    const first = await save('pre',{checked_items:[2,0],expected_checklist_id:null,expected_boundary_id:null});
    const id = first.rows[0].driver_save_checklist;
    const stored = await db.query<{payload:{checked_items:number[];total_items:number}}>('select payload from public.dispatch_events where id=$1',[id]);
    expect(stored.rows[0].payload).toMatchObject({checked_items:[0,2],total_items:8});
    await expect(save('pre',{checked_items:[1],expected_checklist_id:null})).rejects.toMatchObject({code:'40001'});
    await expect(save('pre',{checked_items:[],expected_checklist_id:id})).resolves.toHaveProperty('rows');
  });

  it('rejects a draft belonging to a previous shift boundary', async () => {
    await complete('pre'); await record('start_shift');
    await expect(save('post',{checked_items:[0],expected_checklist_id:null,expected_boundary_id:null})).rejects.toMatchObject({code:'40001'});
  });

  it.each([null,[],{}, {checked_items:[0,0]}, {checked_items:['0']}, {checked_items:[8]},
    {checked_items:[0.5]}, {checked_items:[0],total_items:'8'}, {checked_items:[0],total_items:5}])(
    'rejects malformed checklist payload %#', async payload => {
      await expect(save('pre',payload)).rejects.toMatchObject({code:'22023'});
    });
  it('rejects null checklist kind and inactive driver access', async () => {
    await expect(save(null,{checked_items:[]})).rejects.toMatchObject({code:'22023'});
    await db.exec('update public.drivers set active=false');
    await expect(complete('pre')).rejects.toMatchObject({code:'42501'});
    await expect(db.query('select public.driver_get_journey_context($1)',[tenantId])).rejects.toMatchObject({code:'42501'});
  });

  it('reads only personal tenant history, even after trip reassignment', async () => {
    await complete('pre'); await record('start_shift');
    await db.query(`insert into public.dispatch_events(tenant_id,dispatch_trip_id,event_type,created_by)
      values ($1,$2,'end_shift','10000000-0000-4000-8000-000000000099'),
      ('20000000-0000-4000-8000-000000000002',$2,'rest',$3)`,[tenantId,tripId,userId]);
    await db.exec('update public.dispatch_trips set driver_id=null; set role authenticated');
    const result = await db.query<{driver_get_journey_context:{events:{event_type:string}[];last_start:{id:string};last_end:null}}>(
      'select public.driver_get_journey_context($1)',[tenantId]);
    expect(result.rows[0].driver_get_journey_context.events.map(event=>event.event_type)).toEqual(['start_shift']);
    expect(result.rows[0].driver_get_journey_context.last_end).toBeNull();
    await expect(db.query('select public.driver_get_journey_context($1)',['20000000-0000-4000-8000-000000000002'])).rejects.toMatchObject({code:'42501'});
    await expect(record('lunch')).rejects.toMatchObject({code:'42501'});
  });

  it('does not accept another actor’s complete checklist', async () => {
    await complete('pre');
    await db.query('update public.dispatch_events set created_by=$1',['10000000-0000-4000-8000-000000000099']);
    await expect(record('start_shift')).rejects.toMatchObject({code:'23514'});
  });

  it('rehearses restoring the captured production functions and grants without deleting history', async () => {
    await complete('pre'); await record('start_shift');
    const before = await db.query('select id,event_type,payload from public.dispatch_events order by event_at,id');
    const snapshot = JSON.parse(readFileSync(join(process.cwd(),'docs/qa/JOURNEY-PREDEPLOYMENT-CONTRACTS-2026-08-30.json'),'utf8')) as {
      functions: {proname:string;definition_hash:string}[];
    };
    try {
      await db.exec(readFileSync(join(process.cwd(),'docs/qa/JOURNEY-RECOVERY-2026-08-30.sql'),'utf8'));
      const restored = await db.query<{proname:string;definition_hash:string}>(`select proname,md5(replace(pg_get_functiondef(oid),chr(13),'')) definition_hash
        from pg_proc where pronamespace='public'::regnamespace and proname in ('_assert_driver_owns_trip','driver_create_event','driver_save_checklist') order by proname`);
      expect(restored.rows).toEqual(snapshot.functions.map(({proname,definition_hash})=>({proname,definition_hash})));
      expect((await db.query('select id,event_type,payload from public.dispatch_events order by event_at,id')).rows).toEqual(before.rows);
      const permissions = await db.query(`select has_function_privilege('authenticated','public.driver_create_event(uuid,text,jsonb,uuid,text)','execute') authenticated,
        has_function_privilege('service_role','public.driver_save_checklist(uuid,text,jsonb)','execute') service,
        has_function_privilege('anon','public.driver_create_event(uuid,text,jsonb,uuid,text)','execute') anon`);
      expect(permissions.rows).toEqual([{authenticated:true,service:true,anon:false}]);
      await db.exec('set role authenticated');
      await expect(record('operational_note')).resolves.toHaveProperty('rows');
    } finally {
      await db.exec('reset role');
      await db.exec(readFileSync(join(process.cwd(),'supabase/migrations/20260830024309_enforce_driver_journey_state_machine.sql'),'utf8'));
    }
  });
});
