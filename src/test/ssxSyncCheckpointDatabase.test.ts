// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Claim = {
  decision: 'claimed' | 'cached' | 'deferred';
  lease_token?: string;
  error_code?: string;
  retry_after_seconds?: number;
  result?: Record<string, unknown>;
};

const accountId = '20000000-0000-4000-8000-000000000001';
const nonSsxAccountId = '20000000-0000-4000-8000-000000000002';
const migration = readFileSync(
  'supabase/migrations/20260924143248_add_ssx_sync_checkpoints.sql',
  'utf8',
);

let db: PGlite;

async function asService<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

async function claim(resource = 'governance_gate', maxAge = 21600, account = accountId): Promise<Claim> {
  return asService(async () => (await db.query<{ value: Claim }>(
    'select public.claim_ssx_sync_checkpoint_v1($1,$2,$3,$4) value',
    [account, resource, '', maxAge],
  )).rows[0].value);
}

async function finish(token: string, errorCode: string | null = null, retrySeconds = 0,
  result: Record<string, unknown> = {}, resource = 'governance_gate'): Promise<boolean> {
  return asService(async () => (await db.query<{ value: boolean }>(
    'select public.finish_ssx_sync_checkpoint_v1($1,$2,$3,$4,$5::jsonb,$6,$7) value',
    [accountId, resource, '', token, JSON.stringify(result), errorCode, retrySeconds],
  )).rows[0].value);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.integration_accounts(id uuid primary key, provider text not null);
    grant select on public.integration_accounts to service_role;
    insert into public.integration_accounts(id,provider) values
      ('${accountId}','ssx'),('${nonSsxAccountId}','fiscal');
  `);
  await db.exec(migration);
});

beforeEach(async () => {
  await db.exec('truncate public.ssx_sync_checkpoints');
});

afterAll(async () => {
  await db?.close();
});

describe('published SSX checkpoint migration', () => {
  it('exposes invoker RPCs and checkpoint rows only to service_role', async () => {
    const acl = (await db.query<{
      claim_service: boolean; claim_anon: boolean; claim_auth: boolean;
      finish_service: boolean; finish_anon: boolean; finish_auth: boolean;
      table_service: boolean; table_anon: boolean; table_auth: boolean;
      rls: boolean; claim_definer: boolean; finish_definer: boolean;
    }>(`
      select
        has_function_privilege('service_role','public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer)','execute') claim_service,
        has_function_privilege('anon','public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer)','execute') claim_anon,
        has_function_privilege('authenticated','public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer)','execute') claim_auth,
        has_function_privilege('service_role','public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer)','execute') finish_service,
        has_function_privilege('anon','public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer)','execute') finish_anon,
        has_function_privilege('authenticated','public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer)','execute') finish_auth,
        has_table_privilege('service_role','public.ssx_sync_checkpoints','select') table_service,
        has_table_privilege('anon','public.ssx_sync_checkpoints','select') table_anon,
        has_table_privilege('authenticated','public.ssx_sync_checkpoints','select') table_auth,
        (select relrowsecurity from pg_class where oid='public.ssx_sync_checkpoints'::regclass) rls,
        (select prosecdef from pg_proc where oid='public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer)'::regprocedure) claim_definer,
        (select prosecdef from pg_proc where oid='public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer)'::regprocedure) finish_definer
    `)).rows[0];
    expect(acl).toEqual({
      claim_service: true, claim_anon: false, claim_auth: false,
      finish_service: true, finish_anon: false, finish_auth: false,
      table_service: true, table_anon: false, table_auth: false,
      rls: true, claim_definer: false, finish_definer: false,
    });
  });

  it('rejects non-SSX accounts before creating progress', async () => {
    await expect(claim('governance_gate', 0, nonSsxAccountId)).rejects.toThrow('ssx_account_invalid');
    const rows = (await db.query<{ count: number }>(
      'select count(*)::integer count from public.ssx_sync_checkpoints',
    )).rows[0].count;
    expect(rows).toBe(0);
  });

  it('keeps one lease owner, rejects stale tokens, and allows expired leases to be reclaimed', async () => {
    const first = await claim();
    expect(first.decision).toBe('claimed');
    expect(first.lease_token).toBeTruthy();
    expect(await claim()).toMatchObject({ decision: 'deferred', error_code: 'in_progress' });
    expect(await finish(crypto.randomUUID())).toBe(false);

    await db.query(
      `update public.ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second'
       where integration_account_id=$1 and resource='governance_gate'`,
      [accountId],
    );
    const replacement = await claim();
    expect(replacement.decision).toBe('claimed');
    expect(replacement.lease_token).not.toBe(first.lease_token);
    expect(await finish(first.lease_token!)).toBe(false);
    expect(await finish(replacement.lease_token!, null, 0, { count: 2 })).toBe(true);
    expect(await claim()).toMatchObject({ decision: 'cached', result: { count: 2 } });
  });

  it('persists backoff after 429 and clears error, retry and attempts on success', async () => {
    const first = await claim();
    expect(await finish(first.lease_token!, 'rate_limited', 600)).toBe(true);
    expect(await claim()).toMatchObject({ decision: 'deferred', error_code: 'rate_limited' });
    const failed = (await db.query<{
      status: string; attempts: number; retry_seconds: number;
    }>(`
      select status,attempts,
        extract(epoch from retry_at-clock_timestamp())::integer retry_seconds
      from public.ssx_sync_checkpoints where integration_account_id=$1
        and resource='governance_gate'
    `, [accountId])).rows[0];
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(1);
    expect(failed.retry_seconds).toBeGreaterThan(590);

    await db.query(
      `update public.ssx_sync_checkpoints set retry_at=clock_timestamp()-interval '1 second'
       where integration_account_id=$1 and resource='governance_gate'`,
      [accountId],
    );
    const retry = await claim();
    expect(retry.decision).toBe('claimed');
    expect(await finish(retry.lease_token!, null, 0, { count: 4 })).toBe(true);
    const clean = (await db.query<{
      status: string; attempts: number; error_code: string | null;
      retry_at: Date | null; lease_token: string | null; last_success_at: Date | null;
    }>(`
      select status,attempts,error_code,retry_at,lease_token,last_success_at
      from public.ssx_sync_checkpoints where integration_account_id=$1
        and resource='governance_gate'
    `, [accountId])).rows[0];
    expect(clean).toMatchObject({
      status: 'success', attempts: 0, error_code: null,
      retry_at: null, lease_token: null,
    });
    expect(clean.last_success_at).toBeTruthy();
    expect(await claim()).toMatchObject({ decision: 'cached', result: { count: 4 } });
    expect((await claim('governance_gate', 0)).decision).toBe('claimed');
  });

  it('keeps schema/permission errors visible with a bounded attention cooldown', async () => {
    const held = await claim('logged_rule');
    expect(await finish(held.lease_token!, 'invalid_schema', 0, {}, 'logged_rule')).toBe(true);
    const row = (await db.query<{ status: string; retry_seconds: number }>(`
      select status,extract(epoch from retry_at-clock_timestamp())::integer retry_seconds
      from public.ssx_sync_checkpoints where integration_account_id=$1 and resource='logged_rule'
    `, [accountId])).rows[0];
    expect(row.status).toBe('attention_required');
    expect(row.retry_seconds).toBeGreaterThan(21590);
    expect(await claim('logged_rule')).toMatchObject({
      decision: 'deferred', error_code: 'invalid_schema',
    });
  });
});
