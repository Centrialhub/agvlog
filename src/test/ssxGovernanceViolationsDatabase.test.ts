// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260910163922_add_ssx_governance_and_violations.sql',
  'utf8',
);

const accountId = '30000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema ssx_private;
    grant usage on schema public, ssx_private to service_role;
    grant usage on schema public to authenticated;
    create table public.integration_accounts(
      id uuid primary key,
      provider text not null
    );
    create table public.positions_raw(
      id bigint generated always as identity primary key,
      integration_account_id uuid references public.integration_accounts(id),
      telemetry jsonb
    );
    insert into public.integration_accounts(id, provider)
    values ('${accountId}', 'SSX');
    grant select on public.integration_accounts, public.positions_raw to service_role;
  `);
  await db.exec(migration);
}, 30_000);

afterAll(async () => db?.close());

async function asService<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  await db.exec('set role service_role');
  try {
    return (await db.query<T>(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

describe('SSX governance and violations database contract', () => {
  it('extracts an indexed provider position cursor from accepted telemetry', async () => {
    await db.query(
      `insert into public.positions_raw(integration_account_id, telemetry)
       values ($1, '{"IdPosition":"12345"}'::jsonb)`,
      [accountId],
    );
    const rows = await db.query<{ provider_position_id: string }>(
      'select provider_position_id::text from public.positions_raw',
    );
    expect(rows.rows[0].provider_position_id).toBe('12345');
  });

  it('atomically replaces scoped governance snapshots', async () => {
    expect(await asService<{ replaced: number }>(
      `select public.replace_ssx_tracking_snapshot_v1(
        $1, 'logged_rule', '',
        '[{"external_key":"RULE-1","payload":{"RuleIntegrationCode":"RULE-1"}}]'::jsonb
      ) replaced`,
      [accountId],
    )).toEqual([{ replaced: 1 }]);
    await asService(
      `select public.replace_ssx_tracking_snapshot_v1(
        $1, 'logged_rule', '',
        '[{"external_key":"RULE-2","payload":{"RuleIntegrationCode":"RULE-2"}}]'::jsonb
      )`,
      [accountId],
    );
    const rows = await asService<{ external_key: string }>(
      `select external_key from public.ssx_tracking_snapshots
       where integration_account_id=$1 and resource_type='logged_rule'`,
      [accountId],
    );
    expect(rows).toEqual([{ external_key: 'RULE-2' }]);
  });

  it('advances the violation cursor only through compare-and-swap acknowledgement', async () => {
    const window = await asService<{
      expected_last_position_id: string;
      start_position_id: string;
      end_position_id: string;
      should_poll: boolean;
    }>(`select * from public.get_ssx_rule_violation_window_v1($1,1000,50000)`, [accountId]);
    expect(window[0]).toEqual({
      expected_last_position_id: '0', start_position_id: '1',
      end_position_id: '12345', should_poll: true,
    });
    expect((await asService<{ acked: boolean }>(
      `select public.ack_ssx_rule_violation_window_v1($1,7,12345,true,null) acked`,
      [accountId],
    ))[0].acked).toBe(false);
    expect((await asService<{ acked: boolean }>(
      `select public.ack_ssx_rule_violation_window_v1($1,0,12345,true,null) acked`,
      [accountId],
    ))[0].acked).toBe(true);
  });

  it('upserts violations idempotently and keeps browser roles out', async () => {
    const item = JSON.stringify([{
      provider_violation_id: 44,
      rule_integration_code: 'RULE-2',
      tracked_unit_integration_code: 'UNIT-1',
      organizational_unit_integration_code: null,
      driver_integration_code: null,
      initial_date: '2026-09-10T10:00:00.000Z',
      final_date: null,
      payload: { IdRuleViolation: 44 },
    }]);
    await asService(
      'select public.upsert_ssx_rule_violations_v1($1,$2::jsonb)',
      [accountId, item],
    );
    await asService(
      'select public.upsert_ssx_rule_violations_v1($1,$2::jsonb)',
      [accountId, item],
    );
    const count = await asService<{ count: number }>(
      'select count(*)::integer count from public.ssx_rule_violations',
    );
    expect(count[0].count).toBe(1);

    await db.exec('set role authenticated');
    try {
      await expect(db.query('select * from public.ssx_rule_violations'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query(
        `select public.get_ssx_rule_violation_window_v1(
          '${accountId}',1000,50000
        )`,
      )).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec('reset role');
    }
  });
});
