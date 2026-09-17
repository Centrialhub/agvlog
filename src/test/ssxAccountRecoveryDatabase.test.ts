// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ssxIds as i, ssxPositionDatabase } from './helpers/ssxPositionDatabase';

let db: PGlite;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeAll(async () => { db = await ssxPositionDatabase(); });
afterAll(async () => { await db?.close(); });

describe('monotonic SSX account recovery', () => {
  it('clears an older cooldown without erasing a newer rate-limit observation', async () => {
    const older = minutesAgo(2);
    const success = minutesAgo(1);
    await db.query(
      'update integration_accounts ' +
      'set poll_cooldown_until=$2::timestamptz+interval \'5 minutes\',' +
      'last_error=\'Rate limited by SSX (429)\',updated_at=$2 where id=$1',
      [i.account, older],
    );
    await db.exec('set role service_role');
    try {
      const cleared = (await db.query<{ result: Record<string, unknown> }>(
        'select public.clear_ssx_account_cooldown_v1($1,$2,$3) result',
        [i.tenant, i.account, success],
      )).rows[0].result;
      expect(cleared).toMatchObject({
        version: 1, tenant_id: i.tenant, integration_account_id: i.account, cleared: true,
      });
    } finally {
      await db.exec('reset role').catch(() => {});
    }
    expect((await db.query(
      'select poll_cooldown_until,last_error from integration_accounts where id=$1',
      [i.account],
    )).rows[0]).toMatchObject({ poll_cooldown_until: null, last_error: null });

    const newer = new Date().toISOString();
    await db.query(
      'update integration_accounts ' +
      'set poll_cooldown_until=$2::timestamptz+interval \'5 minutes\',' +
      'last_error=\'Newer rate limit\',updated_at=$2 where id=$1',
      [i.account, newer],
    );
    await db.exec('set role service_role');
    try {
      const stale = (await db.query<{ result: Record<string, unknown> }>(
        'select public.clear_ssx_account_cooldown_v1($1,$2,$3) result',
        [i.tenant, i.account, success],
      )).rows[0].result;
      expect(stale).toMatchObject({ cleared: false });
    } finally {
      await db.exec('reset role').catch(() => {});
    }
    expect((await db.query<{ last_error: string }>(
      'select last_error from integration_accounts where id=$1',
      [i.account],
    )).rows[0].last_error).toBe('Newer rate limit');
  });

  it('exposes the recovery RPC only to service_role', async () => {
    const acl = (await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      'select ' +
      'has_function_privilege(\'anon\',\'public.clear_ssx_account_cooldown_v1(uuid,uuid,timestamptz)\',\'execute\') anon,' +
      'has_function_privilege(\'authenticated\',\'public.clear_ssx_account_cooldown_v1(uuid,uuid,timestamptz)\',\'execute\') authenticated,' +
      'has_function_privilege(\'service_role\',\'public.clear_ssx_account_cooldown_v1(uuid,uuid,timestamptz)\',\'execute\') service',
    )).rows[0];
    expect(acl).toEqual({ anon: false, authenticated: false, service: true });
  });
});
