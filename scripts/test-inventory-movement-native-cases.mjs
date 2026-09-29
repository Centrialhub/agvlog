import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function runInventoryMovementNative({ query, queryError, contested, literal: q }) {
  const database = 'inventory_movement_qa';
  const tenant = '10000000-0000-4000-8000-000000000001';
  const otherTenant = '10000000-0000-4000-8000-000000000002';
  const actor = '20000000-0000-4000-8000-000000000001';
  const otherActor = '20000000-0000-4000-8000-000000000002';
  const migrationSql = readFileSync('supabase/migrations/20260926190732_restore_inventory_public_rpcs.sql', 'utf8');
  const migrationHash = createHash('sha256').update(migrationSql).digest('hex');
  await query(`create database ${database}`);
  const run = (sql) => query(sql, database);

  // Only the tables used by the candidate RPC are modeled. The balance trigger
  // records one observable stock effect per inserted movement.
  await run(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.tenant_memberships(
      tenant_id uuid not null,user_id uuid not null,role text not null,active boolean not null,
      primary key(tenant_id,user_id));
    create function public.is_tenant_admin(_tenant_id uuid) returns boolean
      language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.tenant_memberships membership
        where membership.tenant_id=_tenant_id and membership.user_id=auth.uid()
          and membership.active and membership.role in ('owner','admin'))$$;
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text);
    create table public.inventory_locations(id uuid primary key,tenant_id uuid,name text);
    create table public.inventory_balances(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
      client_id uuid,location_id uuid,item_description text not null,
      quantity numeric not null default 0,pallet_count integer not null default 0,
      weight_kg numeric not null default 0,volume_m3 numeric not null default 0,
      first_inbound_at timestamptz,unique(tenant_id,item_description));
    create table public.inventory_movements(
      id uuid primary key,tenant_id uuid not null,location_id uuid,movement_type text,
      adjustment_direction text,client_id uuid,item_description text,quantity numeric,
      pallet_count integer,weight_kg numeric,volume_m3 numeric,fiscal_document_id uuid,
      notes text,moved_at timestamptz,created_at timestamptz,created_by uuid);
    create table public.qa_balance_effects(n integer not null);
    insert into public.qa_balance_effects values(0);
    create function public.qa_apply_inventory_balance() returns trigger
      language plpgsql security definer set search_path='' as $$begin
        insert into public.inventory_balances(tenant_id,item_description,quantity)
        values(new.tenant_id,new.item_description,new.quantity)
        on conflict(tenant_id,item_description) do update set
          quantity=public.inventory_balances.quantity+excluded.quantity;
        update public.qa_balance_effects set n=n+1;
        return new;
      end$$;
    create trigger qa_apply_inventory_balance after insert on public.inventory_movements
      for each row execute function public.qa_apply_inventory_balance();
    insert into public.tenant_memberships values(${q(tenant)},${q(actor)},'admin',true);
    begin; ${migrationSql} commit;
  `);
  assert.equal(await run("select has_function_privilege('authenticated','public.create_inventory_movement_v1(jsonb)','execute')"), 't');
  assert.equal(await run("select has_function_privilege('anon','public.create_inventory_movement_v1(jsonb)','execute')"), 'f');

  const call = (payload, caller = actor) =>
    `select set_config('request.jwt.claim.sub',${q(caller)},false);set role authenticated;` +
    `select public.create_inventory_movement_v1(${q(JSON.stringify(payload))}::jsonb);`;
  const movement = (requestId, quantity = 2, selectedTenant = tenant) => ({
    tenant_id: selectedTenant, request_id: requestId, movement_type: 'inbound',
    item_description: 'Caixa', quantity, pallet_count: 1,
  });
  const result = (output) => {
    const line = output.split(/\r?\n/).find((value) => value.trim().startsWith('{') && value.includes('"request_id"'));
    assert.ok(line, `Missing RPC result: ${output}`);
    return JSON.parse(line);
  };
  const checkOneEffect = async (requestId) => {
    assert.equal(await run(`select count(*) from public.inventory_movements where request_id=${q(requestId)}`), '1');
    assert.equal(await run(`select quantity from public.inventory_balances where tenant_id=${q(tenant)} and item_description='Caixa'`), '2');
    assert.equal(await run('select n from public.qa_balance_effects'), '1');
  };
  let passed = 0;
  const pass = (label) => { passed++; console.log(`PASS ${label}`); };

  const requestId = randomUUID();
  const payload = movement(requestId);
  const race = await contested(call(payload), call(payload), { database });
  const first = result(race.holder.output);
  const second = result(race.waiter.output);
  assert.equal(first.id, second.id);
  assert.equal(first.request_id, requestId);
  await checkOneEffect(requestId);
  pass('same request waits on advisory lock and returns the committed movement once');

  const conflict = await contested(call(payload), call(movement(requestId, 3)),
    { database, waiterSucceeds: false });
  assert.match(conflict.waiter.error, /23505[\s\S]*inventory_request_conflict/);
  await checkOneEffect(requestId);
  pass('changed payload for the same request is rejected without another balance effect');

  const revokedRequest = randomUUID();
  const revokeLock = `select pg_advisory_xact_lock(hashtextextended(${q(`inventory-movement:${tenant}:${revokedRequest}`)},0))`;
  try {
    const revoked = await contested(revokeLock, call(movement(revokedRequest)), {
      database, waiterSucceeds: false,
      holderAfterBlocked: `update public.tenant_memberships set active=false where tenant_id=${q(tenant)} and user_id=${q(actor)}`,
    });
    assert.match(revoked.waiter.error, /42501[\s\S]*inventory_not_authorized/);
    assert.equal(await run(`select count(*) from public.inventory_movements where request_id=${q(revokedRequest)}`), '0');
    await checkOneEffect(requestId);
    pass('revocation while waiting is rechecked before replay or insert');
  } finally {
    await run(`update public.tenant_memberships set active=true where tenant_id=${q(tenant)} and user_id=${q(actor)}`);
  }

  assert.match(await queryError(call(movement(randomUUID()), otherActor), database),
    /42501[\s\S]*inventory_not_authorized/);
  assert.match(await queryError(call(movement(randomUUID(), 1, otherTenant)), database),
    /42501[\s\S]*inventory_not_authorized/);
  await checkOneEffect(requestId);
  pass('unrelated actor and foreign tenant cannot create movements');

  console.log(`Candidate migration SHA256 ${migrationHash}`);
  return passed;
}
