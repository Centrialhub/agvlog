// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260926190733_restore_team_access_public_rpcs.sql', 'utf8');
const tenant = '00000000-0000-4000-8000-000000000301';
const otherTenant = '00000000-0000-4000-8000-000000000302';
const admin = '00000000-0000-4000-8000-000000000303';
const worker = '00000000-0000-4000-8000-000000000304';
const owner = '00000000-0000-4000-8000-000000000305';
const oldUser = '00000000-0000-4000-8000-000000000306';
const invitedUser = '00000000-0000-4000-8000-000000000307';
const client = '00000000-0000-4000-8000-000000000308';
const workerMembership = '00000000-0000-4000-8000-000000000309';
const ownerMembership = '00000000-0000-4000-8000-000000000310';
const oldAccess = '00000000-0000-4000-8000-000000000311';
const invitedAccess = '00000000-0000-4000-8000-000000000312';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create type public.app_role as enum ('owner','admin','operator','driver');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid
    $$;
    select set_config('test.uid','${admin}',false);
    create table public.tenant_memberships(
      id uuid primary key,tenant_id uuid,user_id uuid,role public.app_role,
      active boolean,updated_at timestamptz not null default now()
    );
    create table public.client_portal_access(
      id uuid primary key,tenant_id uuid,user_id uuid,client_id uuid,
      access_type text,active boolean,updated_at timestamptz not null default now()
    );
    create table public.entity_audit_log(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,old_data jsonb,new_data jsonb,actor_user_id uuid,source text
    );
    create function public.is_tenant_admin(_tenant_id uuid) returns boolean
      language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.tenant_memberships m
        where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active
          and m.role in ('owner','admin'))
    $$;
    insert into public.tenant_memberships(id,tenant_id,user_id,role,active) values
      ('00000000-0000-4000-8000-000000000313','${tenant}','${admin}','admin',true),
      ('${workerMembership}','${tenant}','${worker}','operator',true),
      ('${ownerMembership}','${tenant}','${owner}','owner',true),
      ('00000000-0000-4000-8000-000000000314','${otherTenant}','${oldUser}','operator',true);
    insert into public.client_portal_access(id,tenant_id,user_id,client_id,access_type,active) values
      ('${oldAccess}','${tenant}','${oldUser}','${client}','viewer',true),
      ('${invitedAccess}','${tenant}','${invitedUser}','${client}','viewer',true),
      ('00000000-0000-4000-8000-000000000315','${otherTenant}','${oldUser}','${client}','viewer',true);
  `);
  await db.exec(migration);
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));

async function revision(table: 'tenant_memberships' | 'client_portal_access', id: string) {
  return (await db.query<{ updated_at: string }>(
    `select updated_at from public.${table} where id=$1`, [id])).rows[0].updated_at;
}

describe('published Team Management RPC restoration', () => {
  it('exposes only guarded functions and installs one membership audit trigger', async () => {
    for (const signature of [
      'public.update_tenant_membership_v1(uuid,timestamptz,text,boolean)',
      'public.mutate_client_portal_access_v1(uuid,timestamptz,text,boolean)',
      'public.replace_portal_access_after_invite_v1(uuid,timestamptz,uuid)',
    ]) {
      expect((await db.query<{ definer: boolean; config: string[]; anon: boolean; authenticated: boolean }>(`
        select p.prosecdef definer,p.proconfig config,
          has_function_privilege('anon',$1,'execute') anon,
          has_function_privilege('authenticated',$1,'execute') authenticated
        from pg_proc p where p.oid=to_regprocedure($1)`, [signature])).rows)
        .toEqual([{ definer: true, config: ['search_path=""'], anon: false, authenticated: true }]);
    }
    expect((await db.query<{ count: number }>(`
      select count(*)::int count from pg_trigger
      where tgrelid='public.tenant_memberships'::regclass
        and tgname='audit_tenant_membership_change_v1' and not tgisinternal`
    )).rows[0].count).toBe(1);
    await db.exec(migration);
    expect((await db.query<{ count: number }>(`
      select count(*)::int count from pg_trigger
      where tgrelid='public.tenant_memberships'::regclass
        and tgname='audit_tenant_membership_change_v1' and not tgisinternal`
    )).rows[0].count).toBe(1);
  });

  it('updates a membership once, audits before and after, and rejects stale or owner changes', async () => {
    const expected = await revision('tenant_memberships', workerMembership);
    const result = await db.query<{ value: { role: string; active: boolean } }>(
      'select public.update_tenant_membership_v1($1,$2,$3,$4) value',
      [workerMembership, expected, 'driver', false]);
    expect(result.rows[0].value).toMatchObject({ role: 'driver', active: false });
    expect((await db.query<{ old_data: { role: string }; new_data: { role: string } }>(
      "select old_data,new_data from public.entity_audit_log where entity_type='tenant_membership'"
    )).rows).toMatchObject([{ old_data: { role: 'operator' }, new_data: { role: 'driver' } }]);
    await db.exec('savepoint stale_membership');
    try {
      await expect(db.query('select public.update_tenant_membership_v1($1,$2,$3,$4)',
        [workerMembership, '2000-01-01T00:00:00Z', 'admin', null]))
        .rejects.toThrow('membership_revision_conflict');
    } finally { await db.exec('rollback to savepoint stale_membership'); }
    await expect(db.query('select public.update_tenant_membership_v1($1,$2,$3,$4)',
      [ownerMembership, await revision('tenant_memberships', ownerMembership), 'operator', null]))
      .rejects.toThrow('owner_membership_immutable');
  });

  it('mutates portal access with a revision and writes a corresponding audit row', async () => {
    const expected = await revision('client_portal_access', oldAccess);
    const result = await db.query<{ value: { active: boolean } }>(
      'select public.mutate_client_portal_access_v1($1,$2,$3,$4) value',
      [oldAccess, expected, 'set_active', false]);
    expect(result.rows[0].value.active).toBe(false);
    expect((await db.query<{ action: string }>(
      "select action from public.entity_audit_log where entity_type='client_portal_access'"
    )).rows).toEqual([{ action: 'set_active' }]);
    await expect(db.query('select public.mutate_client_portal_access_v1($1,$2,$3,$4)',
      [oldAccess, '2000-01-01T00:00:00Z', 'delete', null]))
      .rejects.toThrow('portal_access_revision_conflict');
  });

  it('replaces an invited portal grant atomically and denies a foreign tenant', async () => {
    const result = await db.query<{ value: { id: string } }>(
      'select public.replace_portal_access_after_invite_v1($1,$2,$3) value',
      [oldAccess, await revision('client_portal_access', oldAccess), invitedUser]);
    expect(result.rows[0].value.id).toBe(invitedAccess);
    expect((await db.query<{ count: number }>(
      'select count(*)::int count from public.client_portal_access where id=$1', [oldAccess])).rows[0].count).toBe(0);
    expect((await db.query<{ action: string }>(
      "select action from public.entity_audit_log where entity_type='client_portal_access'"
    )).rows).toEqual([{ action: 'transfer_after_invite' }]);
    await expect(db.query('select public.mutate_client_portal_access_v1($1,$2,$3,$4)',
      ['00000000-0000-4000-8000-000000000315',
        await revision('client_portal_access', '00000000-0000-4000-8000-000000000315'), 'delete', null]))
      .rejects.toThrow('not_authorized');
  });
});
