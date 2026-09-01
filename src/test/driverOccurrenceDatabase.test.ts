// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tenant = '20000000-0000-4000-8000-000000000001';
const driver = '60000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000003';
const trip = '80000000-0000-4000-8000-000000000001';
const stop = '82000000-0000-4000-8000-000000000001';
const client = '40000000-0000-4000-8000-000000000001';
const invoice = '90000000-0000-4000-8000-000000000001';
const load = '70000000-0000-4000-8000-000000000001';
const historicalOccurrence = '0cff2aa3-2aca-431d-ad7d-26367b6f48c2';
const productionDescriptionHash = '17d4bc0884d69d4b581c8d84890cb84b';
const occurrenceMigration = readFileSync(
  'supabase/migrations/20260831232156_remove_trip_load_from_unscoped_driver_occurrences.sql',
  'utf8',
);
let db: PGlite;
const record = (stopId: string | null = null, clientId: string | null = null) => db.query(
  `select public.driver_create_operational_occurrence($1,'other','Test occurrence','medium',$2,$3)`, [trip,stopId,clientId],
);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.drivers(id uuid primary key, tenant_id uuid, user_id uuid, active boolean);
    create table public.dispatch_trips(id uuid primary key, tenant_id uuid, driver_id uuid, status text, load_id uuid, vehicle_id uuid);
    create table public.dispatch_trip_loads(id uuid default gen_random_uuid(), tenant_id uuid, dispatch_trip_id uuid, load_id uuid, created_at timestamptz default now());
    create table public.dispatch_stops(id uuid primary key, tenant_id uuid, dispatch_trip_id uuid, client_id uuid);
    create table public.fiscal_documents(id uuid primary key, tenant_id uuid, client_id uuid);
    create table public.dispatch_stop_documents(id uuid default gen_random_uuid(), tenant_id uuid, dispatch_stop_id uuid, fiscal_document_id uuid, created_at timestamptz default now());
    create table public.dispatch_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, dispatch_trip_id uuid, dispatch_stop_id uuid, event_type text, payload jsonb, notes text, created_by uuid);
    create table public.operational_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, client_id uuid, load_id uuid, vehicle_id uuid, driver_id uuid,
      dispatch_trip_id uuid, dispatch_stop_id uuid, fiscal_document_id uuid, event_type text, severity text, description text,
      visible_to_client boolean, client_action_required boolean, public_status text, payload jsonb, created_by uuid, updated_at timestamptz default now());
    create table public.entity_audit_log(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, entity_type text not null,
      entity_id uuid not null, action text not null, old_data jsonb, new_data jsonb,
      actor_user_id uuid, actor_role text, source text, request_id text, created_at timestamptz default now()
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260830013356_harden_driver_occurrence_scope.sql', 'utf8'));
  await db.exec(occurrenceMigration);
}, 30000);
beforeEach(async () => {
  await db.exec('reset role; truncate public.entity_audit_log, public.operational_events, public.dispatch_events, public.dispatch_stop_documents, public.fiscal_documents, public.dispatch_stops, public.dispatch_trip_loads, public.dispatch_trips, public.drivers');
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub',user]);
  await db.query('insert into public.drivers values($1,$2,$3,true)', [driver,tenant,user]);
  await db.query("insert into public.dispatch_trips(id,tenant_id,driver_id,status,load_id) values($1,$2,$3,'in_transit',$4)", [trip,tenant,driver,load]);
  await db.query('insert into public.dispatch_stops values($1,$2,$3,$4)', [stop,tenant,trip,client]);
  await db.query('insert into public.fiscal_documents values($1,$2,$3)', [invoice,tenant,client]);
  await db.query('insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)', [tenant,stop,invoice]);
});
afterAll(async () => db?.close());

describe('driver occurrence RPC executed in PostgreSQL', () => {
  it('never infers stop/client/invoice for an intentional trip-scoped occurrence', async () => {
    await db.exec('set role authenticated');
    await record();
    await db.exec('reset role');
    const { rows } = await db.query('select dispatch_stop_id,client_id,load_id,fiscal_document_id,visible_to_client,payload from public.operational_events');
    expect(rows).toEqual([expect.objectContaining({ dispatch_stop_id:null, client_id:null, load_id:null, fiscal_document_id:null, visible_to_client:false, payload:{source:'driver_app',scope:'trip'} })]);
  });
  it('derives a unique explicit-stop invoice but keeps the occurrence internal', async () => {
    await record(stop,client);
    const { rows } = await db.query('select dispatch_stop_id,client_id,load_id,fiscal_document_id,visible_to_client from public.operational_events');
    expect(rows).toEqual([{ dispatch_stop_id:stop,client_id:client,load_id:load,fiscal_document_id:invoice,visible_to_client:false }]);
  });
  it('does not arbitrarily select an invoice from a multi-document stop', async () => {
    const secondInvoice = '90000000-0000-4000-8000-000000000002';
    await db.query('insert into public.fiscal_documents values($1,$2,$3)', [secondInvoice,tenant,client]);
    await db.query('insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)', [tenant,stop,secondInvoice]);
    await record(stop,client);
    expect((await db.query('select fiscal_document_id from public.operational_events')).rows).toEqual([{fiscal_document_id:null}]);
  });
  it('rejects stale client input when no stop was selected', async () => {
    await expect(record(null,client)).rejects.toMatchObject({code:'22023'});
    expect((await db.query('select * from public.dispatch_events')).rows).toHaveLength(0);
  });
  it('rejects another tenant stop and an unrelated client', async () => {
    await expect(record('82000000-0000-4000-8000-000000000099')).rejects.toMatchObject({code:'42501'});
    await expect(record(stop,'40000000-0000-4000-8000-000000000099')).rejects.toMatchObject({code:'42501'});
  });
  it('rejects unauthenticated, foreign and inactive drivers', async () => {
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub','']);
    await expect(record()).rejects.toMatchObject({code:'42501'});
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub',client]);
    await expect(record()).rejects.toMatchObject({code:'42501'});
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub',user]);
    await db.exec('update public.drivers set active=false');
    await expect(record()).rejects.toMatchObject({code:'42501'});
  });

  it('repairs the known historical load association once and preserves an exact audit trail', async () => {
    const fixtureDescription = 'Descrição histórica sintética apenas para PGlite';
    const fixtureHash = createHash('md5').update(fixtureDescription).digest('hex');
    const executableMigration = occurrenceMigration.replace(productionDescriptionHash, fixtureHash);
    await db.query(`insert into public.operational_events(
      id,tenant_id,client_id,load_id,vehicle_id,driver_id,dispatch_trip_id,dispatch_stop_id,
      fiscal_document_id,event_type,severity,description,visible_to_client,client_action_required,
      public_status,payload,created_by
    ) values($1,$2,null,$3,$4,$5,$6,null,null,'other','medium',$7,false,false,
      'reported_by_driver','{}'::jsonb,$8)`, [
      historicalOccurrence,
      '6e874e6e-5bca-486d-9928-bef0646989c4',
      '585c92b4-cad8-468b-a2b0-8c08c2dcd849',
      '8c80a14e-f5f2-48b5-b0e0-e80b1d7daf4c',
      'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28',
      '1efc5b8d-9dfc-426a-8c3b-c6def66b9afe',
      fixtureDescription,
      '87873f27-3602-4f5c-8a27-191355c6e326',
    ]);

    await db.exec(executableMigration);
    await db.exec(executableMigration);

    expect((await db.query('select load_id,description from public.operational_events where id=$1', [historicalOccurrence])).rows)
      .toEqual([{load_id:null,description:fixtureDescription}]);
    expect((await db.query(`select entity_type,entity_id,action,old_data,new_data,actor_role,source,request_id
      from public.entity_audit_log where entity_id=$1`, [historicalOccurrence])).rows).toEqual([{
      entity_type:'operational_event', entity_id:historicalOccurrence,
      action:'repair_driver_occurrence_load_scope',
      old_data:{load_id:'585c92b4-cad8-468b-a2b0-8c08c2dcd849'}, new_data:{load_id:null},
      actor_role:'system', source:'driver_occurrence_load_scope_repair', request_id:'20260831225210',
    }]);
  });

  it('fails closed without audit when the historical target differs from preflight', async () => {
    const fixtureDescription = 'Descrição histórica sintética apenas para PGlite';
    const fixtureHash = createHash('md5').update(fixtureDescription).digest('hex');
    const executableMigration = occurrenceMigration.replace(productionDescriptionHash, fixtureHash);
    await db.query(`insert into public.operational_events(
      id,tenant_id,load_id,vehicle_id,driver_id,dispatch_trip_id,event_type,severity,description,
      visible_to_client,client_action_required,public_status,payload,created_by
    ) values($1,$2,$3,$4,$5,$6,'other','medium',$7,false,false,'reported_by_driver','{}'::jsonb,$8)`, [
      historicalOccurrence,
      '6e874e6e-5bca-486d-9928-bef0646989c4',
      '585c92b4-cad8-468b-a2b0-8c08c2dcd849',
      '8c80a14e-f5f2-48b5-b0e0-e80b1d7dafff',
      'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28',
      '1efc5b8d-9dfc-426a-8c3b-c6def66b9afe',
      fixtureDescription,
      '87873f27-3602-4f5c-8a27-191355c6e326',
    ]);

    await expect(db.exec(executableMigration)).rejects.toThrow('Historical occurrence precondition failed');
    expect((await db.query('select load_id from public.operational_events where id=$1', [historicalOccurrence])).rows)
      .toEqual([{load_id:'585c92b4-cad8-468b-a2b0-8c08c2dcd849'}]);
    expect((await db.query('select * from public.entity_audit_log')).rows).toHaveLength(0);
  });
});
