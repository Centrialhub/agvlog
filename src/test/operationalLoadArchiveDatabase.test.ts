// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261127191506_archive_operational_load_preserving_history.sql', 'utf8');
const tenant = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const load = '70000000-0000-4000-8000-000000000001';
const second = '70000000-0000-4000-8000-000000000002';
const trip = '80000000-0000-4000-8000-000000000001';
const reason = 'Limpeza operacional autorizada; preservar documentos e histórico.';
let db: PGlite;
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.loads(id uuid primary key,tenant_id uuid,load_number text,version integer default 1,
  status text,trip_id uuid,updated_at timestamptz);
 alter table public.loads enable row level security;
 create policy tenant_select on public.loads for select to authenticated using(tenant_id='${tenant}');
 grant select,update on public.loads to authenticated;
 create table public.fiscal_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,
  load_id uuid references public.loads(id),remitter_cnpj text,cte_emitted_at timestamptz,value numeric,status text);
 create table public.dispatch_trips(id uuid primary key,tenant_id uuid,load_id uuid references public.loads(id),
  status text,updated_at timestamptz);
 create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid,
  dispatch_trip_id uuid references public.dispatch_trips(id),load_id uuid references public.loads(id));
 create table public.physical_journeys(id uuid primary key,status text,updated_at timestamptz);
 create table public.physical_journey_trips(physical_journey_id uuid references public.physical_journeys(id),dispatch_trip_id uuid);
 create table public.dispatch_stops(id uuid primary key default gen_random_uuid(),tenant_id uuid,
  dispatch_trip_id uuid references public.dispatch_trips(id),status text,actual_arrival_at timestamptz,
  actual_departure_at timestamptz,updated_at timestamptz);
 create table public.trip_cargo_load_checks(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id) on delete restrict);
 create function private.cargo_immutable() returns trigger language plpgsql as $$begin raise exception 'cargo_immutable';end$$;
 create trigger preserve_checks before update or delete on public.trip_cargo_load_checks
  for each row execute function private.cargo_immutable();
 create function private.assert_transit_graph() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.loads l join public.dispatch_trips t on t.id=l.trip_id
  where l.status='in_transit' and t.status='cancelled') then raise exception 'trip_must_be_started_before_load';end if;
 return null;end$$;
 create constraint trigger graph_gate after update on public.dispatch_trips deferrable initially deferred
  for each row execute function private.assert_transit_graph();`);
 for (const table of ['proof_of_delivery','delivery_document_outcomes','payables','receivables','load_payments','driver_settlement_loads']) {
  await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));`);
 }
 await db.exec(sql);
}, 40_000);
beforeEach(async () => {
 await db.exec('begin');
 await db.query(`insert into public.loads(id,tenant_id,load_number,status,trip_id) values($1,$2,'QA','in_transit',$3)`, [load,tenant,trip]);
 await db.query(`insert into public.dispatch_trips values($1,$2,$3,'in_transit',null)`, [trip,tenant,load]);
 await db.query(`insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)`, [tenant,trip,load]);
 await db.query(`insert into public.physical_journeys values($1,'active',null)`,[trip]);
 await db.query(`insert into public.physical_journey_trips values($1,$1)`,[trip]);
 await db.query(`insert into public.dispatch_stops(tenant_id,dispatch_trip_id,status) values($1,$2,'pending')`, [tenant,trip]);
 await db.query(`insert into public.fiscal_documents(tenant_id,load_id,remitter_cnpj,cte_emitted_at,value,status)
  values($1,$2,'11111111000111',now(),123.45,'confirmed')`, [tenant,load]);
 await db.query('insert into public.trip_cargo_load_checks(load_id) values($1)', [load]);
});
afterEach(async () => { await db.exec('rollback;reset role'); });
afterAll(async () => { await db?.close(); });
const archive = (id = load, tid = tenant, version = 1, why = reason) => db.query<{ result: Record<string,unknown> }>(
 'select private.archive_non_jmacedo_load_for_cleanup($1,$2,$3,$4) result', [tid,id,version,why]);
const snapshot = async () => (await db.query(`select
 (select jsonb_agg(to_jsonb(f) order by id) from public.fiscal_documents f) documents,
 (select jsonb_agg(to_jsonb(c) order by id) from public.trip_cargo_load_checks c) checks,
 (select jsonb_agg(to_jsonb(l) order by id) from public.dispatch_trip_loads l) links`)).rows;

it('removes the operation from authenticated listings while preserving fiscal emission and immutable checks', async () => {
 const before = await snapshot();
 expect((await archive()).rows[0].result).toMatchObject({archived:true,history_preserved:true,fiscal_documents_unchanged:true});
 await db.exec('set constraints all immediate');
 expect(await snapshot()).toEqual(before);
 expect((await db.query('select status from public.dispatch_trips')).rows[0]).toEqual({status:'cancelled'});
 expect((await db.query('select status from public.dispatch_stops')).rows[0]).toEqual({status:'cancelled'});
 expect((await db.query('select status from public.physical_journeys')).rows[0]).toEqual({status:'cancelled'});
 await db.exec('set local role authenticated');
 expect((await db.query('select count(*)::int n from public.loads')).rows[0]).toEqual({n:0});
});
it('preserves both JMacêdo CNPJs including a mixed load', async () => {
 for (const cnpj of ['14.998.371/0031-34','14998371003215']) {
  await db.query(`insert into public.fiscal_documents(tenant_id,load_id,remitter_cnpj) values($1,$2,$3)`, [tenant,load,cnpj]);
 }
 await expect(archive()).rejects.toThrow('preserved_jmacedo_or_tenant_mismatch');
});
it('replays exactly without duplicating audit or changing documents', async () => {
 await archive();const before=await snapshot();
 expect((await archive()).rows[0].result).toMatchObject({archived:true,replayed:true});
 expect(await snapshot()).toEqual(before);
 expect((await db.query('select count(*)::int n from private.operational_load_archives')).rows[0]).toEqual({n:1});
});
it('rejects stale revisions atomically', async () => {
 await expect(archive(load,tenant,2)).rejects.toThrow('load_revision_conflict');
});
it('rejects a different tenant', async () => {
 await expect(archive(load,other)).rejects.toThrow('load_not_found');
});
it('does not cancel another load in a shared trip', async () => {
 await db.query(`insert into public.loads(id,tenant_id,load_number,status,trip_id) values($1,$2,'QA2','ready',$3)`, [second,tenant,trip]);
 await expect(archive()).rejects.toThrow('archive_shared_trip_requires_replanning');
});
it('requires the dedicated delivery correction for recorded deliveries', async () => {
 await db.query('insert into public.proof_of_delivery(load_id) values($1)', [load]);
 await expect(archive()).rejects.toThrow('archive_requires_delivery_or_finance_correction');
});
it('does not cancel a shared physical journey', async () => {
 await db.query('insert into public.physical_journey_trips values($1,$2)',[trip,second]);
 await expect(archive()).rejects.toThrow('archive_shared_journey_requires_replanning');
});
it('requires the finance correction for existing financial records', async () => {
 await db.query('insert into public.payables(load_id) values($1)', [load]);
 await expect(archive()).rejects.toThrow('archive_requires_delivery_or_finance_correction');
});
it('does not expose administrative removal or snapshots to application roles', async () => {
 const rows=(await db.query(`select role,
 has_function_privilege(role,'private.archive_non_jmacedo_load_for_cleanup(uuid,uuid,integer,text)','execute') allowed,
 has_table_privilege(role,'private.operational_load_archives','select') snapshots
 from unnest(array['anon','authenticated','service_role']) role`)).rows;
 expect(rows).toEqual(['anon','authenticated','service_role'].map(role=>({role,allowed:false,snapshots:false})));
});
it('rejects updates to the archived load and its immutable audit', async () => {
 await archive();await db.exec('savepoint load_write');
 await expect(db.query('update public.loads set status=$1 where id=$2',['ready',load])).rejects.toThrow('operational_load_archived');
 await db.exec('rollback to savepoint load_write');
 await expect(db.exec('delete from private.operational_load_archives')).rejects.toThrow('operational_load_archive_history_immutable');
});
it('cannot mark a load archived without an audit', async () => {
 await expect(db.query('update public.loads set operational_archived_at=now() where id=$1',[load]))
  .rejects.toThrow('operational_load_archive_requires_audit');
});
