// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = [
  'supabase/migrations/20260910154919_add_ssx_workspace_dispatcher.sql',
  'supabase/migrations/20260910221301_decouple_ssx_dispatcher_from_address_tracking.sql',
].map(path => readFileSync(path, 'utf8')).join('\n');

const ids = {
  tenantReady: '10000000-0000-4000-8000-000000000001',
  tenantDisabled: '10000000-0000-4000-8000-000000000002',
  tenantKilled: '10000000-0000-4000-8000-000000000003',
  tenantReview: '10000000-0000-4000-8000-000000000004',
  workspaceReady: '20000000-0000-4000-8000-000000000001',
  workspaceDisabled: '20000000-0000-4000-8000-000000000002',
  workspaceKilled: '20000000-0000-4000-8000-000000000003',
  workspaceReview: '20000000-0000-4000-8000-000000000004',
  accountReady: '30000000-0000-4000-8000-000000000001',
  accountDisabled: '30000000-0000-4000-8000-000000000002',
  accountKilled: '30000000-0000-4000-8000-000000000003',
  accountReview: '30000000-0000-4000-8000-000000000004',
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.role() returns text language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.role'', true), '''')';

    create schema cron;
    create table cron.job(
      jobid bigint generated always as identity primary key,
      jobname text not null unique
    );
    create function cron.unschedule(_jobid bigint) returns boolean
      language plpgsql
      as $$
      begin
        delete from cron.job where jobid = _jobid;
        return found;
      end;
      $$;

    create table public.workspaces(id uuid primary key);
    create table public.tenants(
      id uuid primary key,
      workspace_id uuid not null references public.workspaces(id)
    );
    create table public.integration_accounts(
      id uuid primary key,
      tenant_id uuid not null references public.tenants(id),
      provider text not null
    );
    create table public.tenant_feature_policy(
      tenant_id uuid not null references public.tenants(id),
      feature_key text not null,
      enabled boolean not null,
      primary key(tenant_id, feature_key)
    );
    create table public.workspace_ssx_accounts(
      workspace_id uuid primary key references public.workspaces(id),
      integration_account_id uuid not null unique references public.integration_accounts(id),
      migration_state text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    insert into public.workspaces(id) values
      ('${ids.workspaceReady}'), ('${ids.workspaceDisabled}'),
      ('${ids.workspaceKilled}'), ('${ids.workspaceReview}');
    insert into public.tenants(id, workspace_id) values
      ('${ids.tenantReady}', '${ids.workspaceReady}'),
      ('${ids.tenantDisabled}', '${ids.workspaceDisabled}'),
      ('${ids.tenantKilled}', '${ids.workspaceKilled}'),
      ('${ids.tenantReview}', '${ids.workspaceReview}');
    insert into public.integration_accounts(id, tenant_id, provider) values
      ('${ids.accountReady}', '${ids.tenantReady}', 'SSX'),
      ('${ids.accountDisabled}', '${ids.tenantDisabled}', 'ssx'),
      ('${ids.accountKilled}', '${ids.tenantKilled}', 'SSX'),
      ('${ids.accountReview}', '${ids.tenantReview}', 'SSX');
    insert into public.workspace_ssx_accounts(workspace_id, integration_account_id, migration_state) values
      ('${ids.workspaceReady}', '${ids.accountReady}', 'ready'),
      ('${ids.workspaceDisabled}', '${ids.accountDisabled}', 'ready'),
      ('${ids.workspaceKilled}', '${ids.accountKilled}', 'ready'),
      ('${ids.workspaceReview}', '${ids.accountReview}', 'needs_resolution');
    insert into public.tenant_feature_policy(tenant_id, feature_key, enabled) values
      ('${ids.tenantReady}', 'ssx_enabled', true),
      ('${ids.tenantReady}', 'ssx_kill_switch', false),
      ('${ids.tenantDisabled}', 'ssx_enabled', false),
      ('${ids.tenantDisabled}', 'ssx_kill_switch', false),
      ('${ids.tenantKilled}', 'ssx_enabled', true),
      ('${ids.tenantKilled}', 'ssx_kill_switch', true),
      ('${ids.tenantReview}', 'ssx_enabled', true),
      ('${ids.tenantReview}', 'ssx_kill_switch', false);
  `);
  await db.exec(migration);
}, 30_000);

afterAll(async () => db?.close());

async function claim() {
  await db.exec('set role service_role');
  await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
  try {
    return (await db.query<{
      workspace_id: string;
      integration_account_id: string;
      tenant_id: string;
      lease_token: string;
      pipeline_mode: 'poll' | 'full';
    }>('select * from public.claim_workspace_ssx_dispatch_v1(8,300)')).rows;
  } finally {
    await db.exec(`select set_config('request.jwt.claim.role','',false)`);
    await db.exec('reset role');
  }
}

async function acknowledge(
  workspaceId: string,
  leaseToken: string,
  success = true,
) {
  await db.exec('set role service_role');
  await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
  try {
    return (await db.query<{ acknowledged: boolean }>(
      `select public.ack_workspace_ssx_dispatch_v1(
        $1, $2, $3, $4, $5, $6
      ) acknowledged`,
      [
        workspaceId,
        leaseToken,
        success,
        success ? 'success' : 'failed',
        success ? null : 'PIPELINE_TEST_FAILURE',
        success ? null : 30,
      ],
    )).rows[0].acknowledged;
  } finally {
    await db.exec(`select set_config('request.jwt.claim.role','',false)`);
    await db.exec('reset role');
  }
}

describe('SSX workspace dispatcher database contract', () => {
  it('claims each eligible workspace once and skips disabled, killed, or unresolved accounts', async () => {
    const rows = await claim();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: ids.workspaceReady,
      integration_account_id: ids.accountReady,
      tenant_id: ids.tenantReady,
      pipeline_mode: 'full',
    });
    expect(rows[0].lease_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await claim()).toEqual([]);
  });

  it('uses compare-and-swap acknowledgement and changes successful full syncs to polling', async () => {
    const leased = (await db.query<{ dispatch_lease_token: string }>(
      `select dispatch_lease_token from public.workspace_ssx_accounts
       where workspace_id='${ids.workspaceReady}'`,
    )).rows[0];
    expect(await acknowledge(ids.workspaceReady, crypto.randomUUID())).toBe(false);
    expect(await acknowledge(ids.workspaceReady, leased.dispatch_lease_token)).toBe(true);
    const schedule = (await db.query<{ delay_seconds: number; last_status: string }>(`
      select extract(epoch from registry.next_dispatch_at-now())::integer delay_seconds,
        registry.last_dispatch_status last_status
      from public.workspace_ssx_accounts registry
      where registry.workspace_id='${ids.workspaceReady}'
    `)).rows[0];
    expect(schedule.last_status).toBe('success');
    expect(schedule.delay_seconds).toBeGreaterThanOrEqual(178);
    expect(schedule.delay_seconds).toBeLessThanOrEqual(180);

    await db.query(
      `update public.workspace_ssx_accounts set next_dispatch_at=now()
       where workspace_id=$1`,
      [ids.workspaceReady],
    );
    const next = await claim();
    expect(next).toHaveLength(1);
    expect(next[0].pipeline_mode).toBe('poll');
  });

  it('reclaims an expired lease with a new token', async () => {
    const before = (await db.query<{ dispatch_lease_token: string }>(
      `select dispatch_lease_token from public.workspace_ssx_accounts
       where workspace_id='${ids.workspaceReady}'`,
    )).rows[0].dispatch_lease_token;
    await db.query(
      `update public.workspace_ssx_accounts
       set dispatch_lease_until=now()-interval '1 second', next_dispatch_at=now()
       where workspace_id=$1`,
      [ids.workspaceReady],
    );
    const reclaimed = await claim();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].lease_token).not.toBe(before);
  });

  it('does not expose dispatcher RPCs to browser roles', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query('select * from public.claim_workspace_ssx_dispatch_v1(8,300)'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query(
        `select public.ack_workspace_ssx_dispatch_v1(
          '${ids.workspaceReady}', '${crypto.randomUUID()}', true, 'success', null, 30
        )`,
      )).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec('reset role');
    }
  });

  it('has no dependency on address-resolution tracking tables', () => {
    const correctiveMigration = readFileSync(
      'supabase/migrations/20260910221301_decouple_ssx_dispatcher_from_address_tracking.sql',
      'utf8',
    );
    const dispatcher = readFileSync(
      'supabase/functions/agvlog-ssx-dispatcher/index.ts',
      'utf8',
    );
    expect(correctiveMigration).not.toMatch(
      /(?:from|join|update)\s+public\.tenant_tracking_schedules/i,
    );
    expect(dispatcher).not.toMatch(/address-resolution|address_resolution/i);
  });
});
