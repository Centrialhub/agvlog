// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917144000_enforce_portal_occurrence_message_visibility.sql',
  'utf8',
);

const tenant = '21000000-0000-4000-8000-000000000001';
const client = '31000000-0000-4000-8000-000000000001';
const user = '11000000-0000-4000-8000-000000000001';
const occurrence = '41000000-0000-4000-8000-000000000001';

let db: PGlite;

async function asPortal<T>(sql: string, params: unknown[] = []) {
  await db.exec('begin; set role authenticated');
  try {
    const result = await db.query<T>(sql, params);
    await db.exec('reset role; commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.operational_events(
      id uuid primary key,
      tenant_id uuid not null,
      client_id uuid,
      visible_to_client boolean not null default false,
      client_opened boolean not null default false,
      updated_at timestamptz not null default now()
    );
    create table public.profiles(id uuid primary key,full_name text);
    create table public.client_occurrence_messages(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      occurrence_id uuid not null,
      author_user_id uuid,
      author_role text not null,
      message text not null,
      created_at timestamptz not null default now()
    );
    create function public._portal_user_client_ids(_tenant_id uuid)
    returns uuid[] language sql stable security definer set search_path=''
    as $$select case when auth.uid()='${user}'::uuid then array['${client}'::uuid] else array[]::uuid[] end$$;
    insert into public.operational_events(id,tenant_id,client_id,visible_to_client)
    values('${occurrence}','${tenant}','${client}',true);
    insert into public.client_occurrence_messages(tenant_id,occurrence_id,author_user_id,author_role,message)
    values('${tenant}','${occurrence}','${user}','client','mensagem inicial');
    select set_config('request.jwt.claim.sub','${user}',false);
  `);
  await db.exec(migration);
});

afterAll(async () => {
  await db?.close();
});

describe('portal occurrence message visibility', () => {
  it('allows reading and replying while the occurrence is visible', async () => {
    const messages = await asPortal<{ message: string }>(
      'select message from public.list_client_occurrence_messages_v2($1,$2)',
      [tenant, occurrence],
    );
    expect(messages.rows).toEqual([{ message: 'mensagem inicial' }]);

    await asPortal('select public.reply_client_occurrence($1,$2,$3)', [tenant, occurrence, '  resposta  ']);
    expect((await db.query<{ message: string }>(
      'select message from public.client_occurrence_messages order by created_at,id',
    )).rows.at(-1)?.message).toBe('resposta');
  });

  it('blocks both endpoints after visibility is revoked, even when client_opened is true', async () => {
    await db.exec(`update public.operational_events
      set visible_to_client=false,client_opened=true where id='${occurrence}'`);

    await expect(asPortal(
      'select * from public.list_client_occurrence_messages_v2($1,$2)',
      [tenant, occurrence],
    )).rejects.toMatchObject({ code: 'P0002' });
    await expect(asPortal(
      'select public.reply_client_occurrence($1,$2,$3)',
      [tenant, occurrence, 'não deve entrar'],
    )).rejects.toMatchObject({ code: 'P0002' });

    const count = await db.query<{ count: number }>('select count(*)::int count from public.client_occurrence_messages');
    expect(count.rows[0].count).toBe(2);
  });

  it('keeps RPC execution unavailable to anonymous users', async () => {
    expect((await db.query(`select
      has_function_privilege('anon','public.list_client_occurrence_messages_v2(uuid,uuid,integer,timestamptz,uuid)','execute') anon_list,
      has_function_privilege('anon','public.reply_client_occurrence(uuid,uuid,text)','execute') anon_reply`)).rows[0])
      .toEqual({ anon_list: false, anon_reply: false });
  });
});
