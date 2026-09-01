// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantId = '10000000-0000-4000-8000-000000000001';
const inviterId = '20000000-0000-4000-8000-000000000001';
const invitedId = '20000000-0000-4000-8000-000000000002';
const replayId = '20000000-0000-4000-8000-000000000003';
const nonce = 'invite-nonce-with-at-least-32-characters-0001';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create schema extensions;
    grant usage on schema private, extensions to service_role;

    create function extensions.digest(value bytea, algorithm text)
    returns bytea
    language sql
    immutable
    as $$
      select decode(
        md5(encode(value, 'hex') || algorithm)
        || md5(algorithm || encode(value, 'hex')),
        'hex'
      )
    $$;
    grant execute on function extensions.digest(bytea, text) to service_role;

    create table public.tenants(id uuid primary key);
    create table auth.users(
      id uuid primary key,
      email text not null,
      raw_user_meta_data jsonb
    );
    insert into public.tenants(id) values ('${tenantId}');
    insert into auth.users(id, email, raw_user_meta_data)
    values ('${inviterId}', 'owner@example.test', '{}'::jsonb);
  `);
  await db.exec(
    readFileSync(
      'supabase/migrations/20260828185133_enforce_invite_only_auth_users.sql',
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      'supabase/migrations/20260828185757_harden_auth_invite_authorizations.sql',
      'utf8',
    ),
  );
}, 30_000);

afterAll(async () => db?.close());

describe('invite-only auth boundary in PostgreSQL', () => {
  it.each(['anon', 'authenticated'])(
    'does not let %s prepare an invitation or read its nonce ledger',
    async (role) => {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query(
            `select public.prepare_auth_invite(
              'blocked@example.test', '${tenantId}', '${inviterId}', '${nonce}'
            )`,
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await db.exec('reset role');
      }
    },
  );

  it('rejects auth.users insertion without an authorized invitation', async () => {
    await expect(
      db.query(
        `insert into auth.users(id, email, raw_user_meta_data)
         values ('${invitedId}', 'invited@example.test', '{}'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '28000' });
  });

  it('accepts one prepared invitation, strips the nonce, and rejects its replay', async () => {
    await db.exec('set role service_role');
    try {
      await db.query(
        `select public.prepare_auth_invite(
          'invited@example.test', '${tenantId}', '${inviterId}', '${nonce}'
        )`,
      );
    } finally {
      await db.exec('reset role');
    }

    await db.query(
      `insert into auth.users(id, email, raw_user_meta_data)
       values (
         '${invitedId}',
         'invited@example.test',
         jsonb_build_object('agvlog_invite_nonce', '${nonce}', 'display_name', 'Invited')
       )`,
    );

    expect(
      (
        await db.query<{ raw_user_meta_data: Record<string, string> }>(
          `select raw_user_meta_data from auth.users where id = '${invitedId}'`,
        )
      ).rows,
    ).toEqual([{ raw_user_meta_data: { display_name: 'Invited' } }]);
    expect(
      (
        await db.query<{ count: number }>(
          'select count(*)::integer count from private.auth_invite_authorizations',
        )
      ).rows,
    ).toEqual([{ count: 0 }]);

    await expect(
      db.query(
        `insert into auth.users(id, email, raw_user_meta_data)
         values (
           '${replayId}',
           'invited@example.test',
           jsonb_build_object('agvlog_invite_nonce', '${nonce}')
         )`,
      ),
    ).rejects.toMatchObject({ code: '28000' });
  });

  it('keeps invitation preparation and its nonce ledger service-only', async () => {
    const rows = (
      await db.query<{
        anon: boolean;
        authenticated: boolean;
        service_role: boolean;
        anon_table: boolean;
        authenticated_table: boolean;
        service_table: boolean;
      }>(`select
        has_function_privilege('anon',
          'public.prepare_auth_invite(text,uuid,uuid,text)', 'EXECUTE') anon,
        has_function_privilege('authenticated',
          'public.prepare_auth_invite(text,uuid,uuid,text)', 'EXECUTE') authenticated,
        has_function_privilege('service_role',
          'public.prepare_auth_invite(text,uuid,uuid,text)', 'EXECUTE') service_role,
        has_table_privilege('anon',
          'private.auth_invite_authorizations', 'SELECT') anon_table,
        has_table_privilege('authenticated',
          'private.auth_invite_authorizations', 'SELECT') authenticated_table,
        has_table_privilege('service_role',
          'private.auth_invite_authorizations', 'SELECT') service_table`)
    ).rows;

    expect(rows).toEqual([
      {
        anon: false,
        authenticated: false,
        service_role: true,
        anon_table: false,
        authenticated_table: false,
        service_table: true,
      },
    ]);
  });
});
