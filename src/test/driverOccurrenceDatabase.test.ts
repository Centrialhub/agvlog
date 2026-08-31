// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tenant = '20000000-0000-4000-8000-000000000001';
const driver = '60000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000003';
const trip = '80000000-0000-4000-8000-000000000001';
const stop = '82000000-0000-4000-8000-000000000001';
const client = '40000000-0000-4000-8000-000000000001';
const invoice = '90000000-0000-4000-8000-000000000001';
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
      visible_to_client boolean, client_action_required boolean, public_status text, payload jsonb, created_by uuid);
  `);
  await db.exec(readFileSync('supabase/migrations/20260830013356_harden_driver_occurrence_scope.sql', 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('reset role; truncate public.operational_events, public.dispatch_events, public.dispatch_stop_documents, public.fiscal_documents, public.dispatch_stops, public.dispatch_trips, public.drivers');
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub',user]);
  await db.query('insert into public.drivers values($1,$2,$3,true)', [driver,tenant,user]);
  await db.query("insert into public.dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'in_transit')", [trip,tenant,driver]);
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
    const { rows } = await db.query('select dispatch_stop_id,client_id,fiscal_document_id,visible_to_client,payload from public.operational_events');
    expect(rows).toEqual([expect.objectContaining({ dispatch_stop_id:null, client_id:null, fiscal_document_id:null, visible_to_client:false, payload:{source:'driver_app',scope:'trip'} })]);
  });
  it('derives a unique explicit-stop invoice but keeps the occurrence internal', async () => {
    await record(stop,client);
    const { rows } = await db.query('select dispatch_stop_id,client_id,fiscal_document_id,visible_to_client from public.operational_events');
    expect(rows).toEqual([{ dispatch_stop_id:stop,client_id:client,fiscal_document_id:invoice,visible_to_client:false }]);
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
});
