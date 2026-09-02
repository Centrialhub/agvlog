// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260902022000_reconcile_disabled_ssx_cron.sql',
  'utf8',
);

const ssxJobs = [
  'agvlog-poll-positions-3min',
  'agvlog-full-sync-6h',
  'agvlog-daily-aggregate',
];

const databases: PGlite[] = [];

async function setupDatabase(options: {
  enabled: boolean;
  killSwitch: boolean;
  tenantSecret?: string;
}) {
  const db = new PGlite();
  databases.push(db);

  await db.exec(`
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

    create schema vault;
    create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
    create table public.tenant_feature_policy(
      tenant_id uuid not null,
      feature_key text not null,
      enabled boolean not null,
      primary key (tenant_id, feature_key)
    );
  `);

  const tenantId = '10000000-0000-4000-8000-000000000001';
  await db.query(
    'insert into vault.decrypted_secrets(name, decrypted_secret) values ($1, $2)',
    ['agvlog_tenant_id', options.tenantSecret ?? tenantId],
  );
  await db.query(
    `insert into public.tenant_feature_policy(tenant_id, feature_key, enabled)
     values ($1, 'ssx_enabled', $2), ($1, 'ssx_kill_switch', $3)`,
    [tenantId, options.enabled, options.killSwitch],
  );
  for (const job of [...ssxJobs, 'cte-status-poll-every-1min']) {
    await db.query('insert into cron.job(jobname) values ($1)', [job]);
  }

  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe('disabled SSX cron reconciliation', () => {
  it('unschedules only SSX jobs when the capability is disabled and remains idempotent', async () => {
    const db = await setupDatabase({ enabled: false, killSwitch: false });

    await db.exec(migration);
    await db.exec(migration);

    const jobs = (await db.query<{ jobname: string }>(
      'select jobname from cron.job order by jobname',
    )).rows.map(({ jobname }) => jobname);
    expect(jobs).toEqual(['cte-status-poll-every-1min']);
  });

  it('keeps SSX jobs when both capability rows make SSX effective', async () => {
    const db = await setupDatabase({ enabled: true, killSwitch: false });

    await db.exec(migration);

    const jobs = (await db.query<{ jobname: string }>(
      'select jobname from cron.job order by jobname',
    )).rows.map(({ jobname }) => jobname);
    expect(jobs).toEqual(['cte-status-poll-every-1min', ...ssxJobs].sort());
  });

  it('fails closed when the configured tenant secret is invalid', async () => {
    const db = await setupDatabase({
      enabled: true,
      killSwitch: false,
      tenantSecret: 'not-a-uuid',
    });

    await db.exec(migration);

    const jobs = (await db.query<{ jobname: string }>(
      'select jobname from cron.job order by jobname',
    )).rows.map(({ jobname }) => jobname);
    expect(jobs).toEqual(['cte-status-poll-every-1min']);
  });
});
