// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260910211000_canonical_destination_geocoding_idempotency.sql',
  'utf8',
);

const ids = {
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '10000000-0000-4000-8000-000000000002',
  actorA: '20000000-0000-4000-8000-000000000001',
  actorB: '20000000-0000-4000-8000-000000000002',
  stopA: '30000000-0000-4000-8000-000000000001',
  stopB: '30000000-0000-4000-8000-000000000002',
  manualStopA: '30000000-0000-4000-8000-000000000003',
  divergenceA: '40000000-0000-4000-8000-000000000001',
  divergenceB: '40000000-0000-4000-8000-000000000002',
  requestResolve: '50000000-0000-4000-8000-000000000001',
  requestGeofence: '50000000-0000-4000-8000-000000000002',
  requestReview: '50000000-0000-4000-8000-000000000003',
};

let db: PGlite;

async function context(actor: string, tenant: string) {
  await db.exec(`set role authenticated;
    select set_config('request.jwt.claim.sub','${actor}',false);
    select set_config('request.active_tenant_id','${tenant}',false);`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    grant usage on schema auth,private to authenticated,service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function private.request_tenant_id() returns uuid language sql stable as $$
      select nullif(current_setting('request.active_tenant_id',true),'')::uuid
    $$;
    create table public.tenants(id uuid primary key);
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text,
      primary key(tenant_id,user_id));
    create function private.is_request_tenant_member(_tenant uuid) returns boolean language sql stable security definer as $$
      select _tenant=private.request_tenant_id() and exists(
        select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active)
    $$;
    grant execute on function private.request_tenant_id(),private.is_request_tenant_member(uuid) to authenticated,service_role;
    create function public.is_tenant_admin(_tenant uuid) returns boolean language sql stable security definer as $$
      select exists(
        select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid()
          and active and role in ('owner','admin'))
    $$;
    create function public.is_tenant_operator_or_admin(_tenant uuid) returns boolean language sql stable security definer as $$
      select exists(
        select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid()
          and active and role in ('owner','admin','operator'))
    $$;
    create function public.stop_terminal_statuses() returns text[] language sql immutable
      as $$select array['delivered','completed','returned','refused','cancelled']::text[]$$;
    create function private.normalized_address_text(_address text) returns text language sql immutable as $$
      select lower(regexp_replace(btrim(coalesce(_address,'')),'\\s+',' ','g'))
    $$;

    create table public.clients(
      id uuid,tenant_id uuid,active boolean default true,company_name text,trade_name text,
      address_street text,address_number text,address_complement text,address_neighborhood text,address_city text,
      address_state text,address_zip text,address_country_name text,address_geocode_status text default 'pending',
      address_lat double precision,address_lng double precision,address_geocode_hash text,address_geocode_provider text,
      address_geocode_accuracy_m double precision,address_geocode_confidence double precision,
      address_geocoded_at timestamptz,address_geocoded_by uuid,address_geocode_audit jsonb default '{}',
      primary key(id),unique(tenant_id,id));
    create function private.normalized_client_address(_client public.clients) returns text language sql immutable as $$
      select private.normalized_address_text(concat_ws(', ',_client.address_street,_client.address_number,
        _client.address_city,_client.address_state,_client.address_zip))
    $$;
    create table public.dispatch_stops(
      id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text,status text default 'pending',
      latitude double precision,longitude double precision,location_source text default 'legacy_coordinates',
      location_address text,location_provider text,location_accuracy_m double precision,location_confidence double precision,
      location_resolved_at timestamptz,location_resolved_by uuid,location_verification_status text default 'pending',
      location_invalidated_at timestamptz,location_audit jsonb default '{}');
    create table public.geofences(id uuid primary key default gen_random_uuid(),tenant_id uuid,name text,category text,
      enabled boolean,scope_kind text default 'fleet',dispatch_stop_id uuid,radius_policy_key text,source_address text);
    alter table public.geofences enable row level security;
    grant select,insert,update,delete on public.geofences to authenticated;
    create policy "Admins can manage geofences" on public.geofences for all to authenticated
      using(public.is_tenant_admin(tenant_id)) with check(public.is_tenant_admin(tenant_id));
    create policy "Members can view geofences" on public.geofences for select to authenticated
      using(public.is_tenant_operator_or_admin(tenant_id));
    create table public.geofence_radius_policies(tenant_id uuid,scope_kind text,category text,radius_m double precision,
      primary key(tenant_id,scope_kind,category));
    alter table public.geofence_radius_policies enable row level security;
    grant select,update on public.geofence_radius_policies to authenticated;
    create policy geofence_radius_policies_select on public.geofence_radius_policies for select to authenticated
      using(public.is_tenant_operator_or_admin(tenant_id));
    create policy geofence_radius_policies_update on public.geofence_radius_policies for update to authenticated
      using(public.is_tenant_admin(tenant_id)) with check(public.is_tenant_admin(tenant_id));
    create table public.address_resolution_queue(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,entity_type text not null,
      entity_id uuid not null,address_snapshot text not null,address_hash text not null,status text default 'pending',
      candidates jsonb default '[]',attempts integer default 0,last_error text,resolved_lat double precision,
      resolved_lng double precision,resolved_provider text,resolved_accuracy_m double precision,
      resolved_confidence double precision,resolved_at timestamptz,resolved_by uuid,invalidated_at timestamptz,
      created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),
      lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz default clock_timestamp(),
      processed_at timestamptz,last_worker_request_key text,resolution_kind text,resolution_details jsonb default '{}',
      unique(tenant_id,entity_type,entity_id),
      constraint address_resolution_queue_entity_type_check check(entity_type='client'),
      constraint address_resolution_queue_client_tenant_fk foreign key(tenant_id,entity_id)
        references public.clients(tenant_id,id));
    alter table public.address_resolution_queue enable row level security;
    grant select,insert,update on public.address_resolution_queue to authenticated;
    create policy address_resolution_queue_select on public.address_resolution_queue for select to authenticated
      using(public.is_tenant_admin(tenant_id));
    create policy address_resolution_queue_update on public.address_resolution_queue for update to authenticated
      using(public.is_tenant_admin(tenant_id)) with check(public.is_tenant_admin(tenant_id));
    create policy address_resolution_queue_insert on public.address_resolution_queue for insert to authenticated
      with check(public.is_tenant_admin(tenant_id));
    create table public.trip_cargo_divergences(id uuid primary key,tenant_id uuid,status text,review_reason text,
      reviewed_at timestamptz,reviewed_by uuid,updated_at timestamptz default clock_timestamp());

    create function public.resolve_address_queue_item_v1(jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
    revoke all on function public.resolve_address_queue_item_v1(jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.resolve_address_queue_item_v1(jsonb) to authenticated;
    create function public.upsert_geofence_v3(_payload jsonb) returns uuid language plpgsql security definer as $$
    declare v_id uuid:=coalesce(nullif(_payload->>'id','')::uuid,gen_random_uuid());begin
      insert into public.geofences(id,tenant_id,name,category,enabled,scope_kind,source_address)
      values(v_id,(_payload->>'tenant_id')::uuid,_payload->>'name',coalesce(_payload->>'category','general'),true,
        'fleet',_payload->>'source_address') on conflict(id) do update set name=excluded.name;
      return v_id;end$$;
    revoke all on function public.upsert_geofence_v3(jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.upsert_geofence_v3(jsonb) to authenticated;
    create function public.upsert_geofence_v2(jsonb) returns uuid language sql as $$select null::uuid$$;
    revoke all on function public.upsert_geofence_v2(jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.upsert_geofence_v2(jsonb) to authenticated;
    create function private.review_trip_cargo_divergence(_tenant uuid,_id uuid,_status text,_reason text)
    returns jsonb language plpgsql security definer as $$begin
      if not public.is_tenant_operator_or_admin(_tenant) then raise exception 'not_authorized' using errcode='42501';end if;
      update public.trip_cargo_divergences set status=_status,review_reason=_reason,reviewed_at=clock_timestamp(),
        reviewed_by=auth.uid(),updated_at=clock_timestamp() where tenant_id=_tenant and id=_id;
      if not found then raise exception 'not_found';end if;
      return jsonb_build_object('version',1,'confirmed',true,'id',_id,'status',_status,
        'control_status','ready_to_depart','updated_at',clock_timestamp());end$$;
    revoke all on function private.review_trip_cargo_divergence(uuid,uuid,text,text)
      from public,anon,authenticated,service_role;
    grant execute on function private.review_trip_cargo_divergence(uuid,uuid,text,text) to authenticated;
    create function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text) returns jsonb language sql
      as $$select '{}'::jsonb$$;
    revoke all on function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text)
      from public,anon,authenticated,service_role;
    grant execute on function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text) to authenticated;
    create function public.claim_address_resolution_queue_v2(integer,integer)
      returns table(id uuid,tenant_id uuid,entity_type text,entity_id uuid,address_snapshot text,address_hash text,
        lease_token uuid,attempts integer) language sql as $$select null::uuid,null::uuid,null::text,null::uuid,
          null::text,null::text,null::uuid,null::integer where false$$;
  `);
  await db.exec(migration);
});

beforeEach(async () => {
  await db.exec(`reset role;truncate public.operator_command_ledger,public.address_resolution_queue,
    public.geofences,public.geofence_radius_policies,public.dispatch_stops,public.clients,public.canonical_addresses,
    public.trip_cargo_divergences,public.tenant_memberships,public.tenants,auth.users cascade;
    insert into auth.users values('${ids.actorA}'),('${ids.actorB}');
    insert into public.tenants values('${ids.tenantA}'),('${ids.tenantB}');
    insert into public.tenant_memberships values
      ('${ids.tenantA}','${ids.actorA}',true,'admin'),('${ids.tenantA}','${ids.actorB}',true,'admin'),
      ('${ids.tenantB}','${ids.actorA}',true,'admin'),('${ids.tenantB}','${ids.actorB}',true,'admin');
    insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,destination,status)
      values('${ids.stopA}','${ids.tenantA}',gen_random_uuid(),'Rua A, 10, Sao Paulo, SP','pending'),
        ('${ids.stopB}','${ids.tenantB}',gen_random_uuid(),'Rua B, 20, Campinas, SP','pending');
    insert into public.trip_cargo_divergences(id,tenant_id,status)
      values('${ids.divergenceA}','${ids.tenantA}','pending'),('${ids.divergenceB}','${ids.tenantB}','pending');
    insert into public.geofence_radius_policies values
      ('${ids.tenantA}','fleet','general',100),('${ids.tenantB}','fleet','general',200);`);
});

afterAll(async () => { await db.close(); });

function resolutionPayload(tenant: string, queue: string, request = ids.requestResolve) {
  return JSON.stringify({ tenant_id: tenant, request_id: request, queue_id: queue, latitude: -23.55,
    longitude: -46.63, provider: 'qa', accuracy_m: 20, confidence: 0.95,
    label: 'Endereco QA', selection_kind: 'assisted_candidate' });
}

describe('canonical destination and operator command idempotency', () => {
  it('queues and resolves a stop without client_id once, then returns the exact replay', async () => {
    await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,destination,status,latitude,
      longitude,location_source,location_address) values($1,$2,gen_random_uuid(),$3,'pending',-22,-45,
      'map_selected',$3)`, [ids.manualStopA, ids.tenantA, 'Rua A, 10, Sao Paulo, SP']);
    const queue = (await db.query<{ id: string }>(`select id from public.address_resolution_queue
      where tenant_id=$1 and entity_type='dispatch_stop' and entity_id=$2`, [ids.tenantA, ids.stopA])).rows[0].id;
    await context(ids.actorA, ids.tenantA);
    const first = (await db.query<{ result: unknown }>('select public.resolve_address_queue_item_v2($1) result',
      [resolutionPayload(ids.tenantA, queue)])).rows[0].result;
    const replay = (await db.query<{ result: unknown }>('select public.resolve_address_queue_item_v2($1) result',
      [resolutionPayload(ids.tenantA, queue)])).rows[0].result;
    expect(replay).toEqual(first);
    await db.exec('reset role');
    expect((await db.query(`select count(*)::int count from public.operator_command_ledger
      where tenant_id=$1 and action='resolve_address'`, [ids.tenantA])).rows[0]).toEqual({ count: 1 });
    expect((await db.query('select client_id,latitude,longitude,location_verification_status from public.dispatch_stops where id=$1',
      [ids.stopA])).rows[0]).toEqual({ client_id: null, latitude: -23.55, longitude: -46.63,
      location_verification_status: 'verified' });
    expect((await db.query('select latitude,longitude,location_source from public.dispatch_stops where id=$1',
      [ids.manualStopA])).rows[0]).toEqual({ latitude: -22, longitude: -45, location_source: 'map_selected' });
  });

  it('rejects payload/actor/tenant conflicts and permits the same request only in an isolated tenant ledger', async () => {
    const rows = await db.query<{ id: string; tenant_id: string }>(`select id,tenant_id from public.address_resolution_queue
      order by tenant_id`);
    await context(ids.actorA, ids.tenantA);
    await db.query('select public.resolve_address_queue_item_v2($1)', [resolutionPayload(ids.tenantA, rows.rows[0].id)]);
    await expect(db.query('select public.resolve_address_queue_item_v2($1)', [JSON.stringify({
      ...JSON.parse(resolutionPayload(ids.tenantA, rows.rows[0].id)), longitude: -47,
    })])).rejects.toThrow(/operator_request_conflict/);
    await db.exec('reset role');
    await context(ids.actorB, ids.tenantA);
    await expect(db.query('select public.resolve_address_queue_item_v2($1)',
      [resolutionPayload(ids.tenantA, rows.rows[0].id)])).rejects.toThrow(/operator_request_conflict/);
    await db.exec('reset role');
    await context(ids.actorA, ids.tenantA);
    await expect(db.query('select public.resolve_address_queue_item_v2($1)',
      [resolutionPayload(ids.tenantB, rows.rows[1].id)])).rejects.toThrow(/not_authorized/);
    await db.exec('reset role');
    await context(ids.actorB, ids.tenantB);
    await db.query('select public.resolve_address_queue_item_v2($1)', [resolutionPayload(ids.tenantB, rows.rows[1].id)]);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from public.operator_command_ledger where request_id=$1',
      [ids.requestResolve])).rows[0]).toEqual({ count: 2 });
  });

  it('rejects tenant B across every operator API while the same dual-member actor has tenant A active', async () => {
    const queueB = (await db.query<{ id: string }>(`select id from public.address_resolution_queue
      where tenant_id=$1 and entity_id=$2`, [ids.tenantB, ids.stopB])).rows[0].id;
    await context(ids.actorA, ids.tenantA);
    await expect(db.query('select public.resolve_address_queue_item_v2($1)',
      [resolutionPayload(ids.tenantB, queueB)])).rejects.toThrow(/not_authorized/);
    await expect(db.query('select public.upsert_geofence_v4($1)', [JSON.stringify({
      tenant_id: ids.tenantB, request_id: ids.requestGeofence, name: 'B', category: 'general',
      scope_kind: 'fleet', source_kind: 'map_selected', center_lat: -23.5, center_lng: -46.6,
    })])).rejects.toThrow(/not_authorized/);
    await expect(db.query('select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5)',
      [ids.tenantB, ids.divergenceB, ids.requestReview, 'approved', 'Conferido pela operacao']))
      .rejects.toThrow(/not_authorized/);
    await expect(db.query('select public.get_address_resolution_queue_v1($1)', [ids.tenantB]))
      .rejects.toThrow(/not_authorized/);
  });

  it('filters canonical command state by active claim even when the actor belongs to both tenants', async () => {
    await db.exec(`insert into public.geofences(id,tenant_id,name,category,enabled,scope_kind)
      values(gen_random_uuid(),'${ids.tenantB}','Patio B','general',true,'fleet');
      insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
      values('${ids.tenantB}','${ids.requestReview}','${ids.actorA}','review_trip_cargo_divergence',
        'trip_cargo_divergence','${ids.divergenceB}',repeat('a',64),'{}');`);
    await context(ids.actorA, ids.tenantA);
    expect((await db.query('select count(*)::int count from public.canonical_addresses where tenant_id=$1',
      [ids.tenantB])).rows[0]).toEqual({ count: 0 });
    expect((await db.query('select count(*)::int count from public.address_resolution_queue where tenant_id=$1',
      [ids.tenantB])).rows[0]).toEqual({ count: 0 });
    expect((await db.query('select count(*)::int count from public.geofences where tenant_id=$1',
      [ids.tenantB])).rows[0]).toEqual({ count: 0 });
    expect((await db.query('select count(*)::int count from public.geofence_radius_policies where tenant_id=$1',
      [ids.tenantB])).rows[0]).toEqual({ count: 0 });
    expect((await db.query('select count(*)::int count from public.operator_command_ledger where tenant_id=$1',
      [ids.tenantB])).rows[0]).toEqual({ count: 0 });
  });

  it('deduplicates geofence upsert and cargo-divergence approval with tenant/actor-bound hashes', async () => {
    await context(ids.actorA, ids.tenantA);
    const fencePayload = JSON.stringify({ tenant_id: ids.tenantA, request_id: ids.requestGeofence,
      name: 'Patio QA', category: 'general', scope_kind: 'fleet', source_kind: 'map_selected',
      source_address: 'Rua A, 10, Sao Paulo, SP', center_lat: -23.55, center_lng: -46.63 });
    const fenceFirst = (await db.query<{ result: unknown }>('select public.upsert_geofence_v4($1) result', [fencePayload])).rows[0].result;
    const fenceReplay = (await db.query<{ result: unknown }>('select public.upsert_geofence_v4($1) result', [fencePayload])).rows[0].result;
    expect(fenceReplay).toEqual(fenceFirst);
    const reviewArgs = [ids.tenantA, ids.divergenceA, ids.requestReview, 'approved', 'Conferido pela operacao'];
    const reviewFirst = (await db.query<{ result: unknown }>(
      'select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5) result', reviewArgs)).rows[0].result;
    const reviewReplay = (await db.query<{ result: unknown }>(
      'select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5) result', reviewArgs)).rows[0].result;
    expect(reviewReplay).toEqual(reviewFirst);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from public.geofences')).rows[0]).toEqual({ count: 1 });
    expect((await db.query(`select action,count(*)::int count from public.operator_command_ledger
      where tenant_id=$1 group by action order by action`, [ids.tenantA])).rows).toEqual([
      { action: 'review_trip_cargo_divergence', count: 1 },
      { action: 'upsert_geofence', count: 1 },
    ]);
  });

  it('refuses a cargo-review replay after active-tenant switch or membership removal', async () => {
    const reviewArgs = [ids.tenantA, ids.divergenceA, ids.requestReview, 'approved', 'Conferido pela operacao'];
    await context(ids.actorA, ids.tenantA);
    await db.query('select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5)', reviewArgs);
    await context(ids.actorA, ids.tenantB);
    await expect(db.query('select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5)', reviewArgs))
      .rejects.toThrow(/not_authorized/);
    await db.exec('reset role');
    await db.query('update public.tenant_memberships set active=false where tenant_id=$1 and user_id=$2',
      [ids.tenantA, ids.actorA]);
    await context(ids.actorA, ids.tenantA);
    await expect(db.query('select public.review_trip_cargo_divergence_v2($1,$2,$3,$4,$5)', reviewArgs))
      .rejects.toThrow(/not_authorized/);
  });
});
