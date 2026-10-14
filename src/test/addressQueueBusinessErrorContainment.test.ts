// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const queueRepair = read('supabase/migrations/20261009151836_address_queue_business_errors_no_serialization_retry.sql');
const recordRepair = read('supabase/migrations/20261009161011_address_candidate_business_errors_no_serialization_retry.sql');
const legacyRecord = read('supabase/migrations/20260926190513_restore_address_candidate_recording_rpc.sql');
const fixture = read('src/test/processAddressResolutionQueueErrorAck.test.ts');
const setup = fixture.match(/beforeAll\(async \(\) => \{[\s\S]*?await db\.exec\(\x60([\s\S]*?)\x60\);/)?.[1];
const seedTemplate = fixture.match(/beforeEach\(async \(\) => \{[\s\S]*?await db\.exec\(\x60([\s\S]*?)\x60\);/)?.[1];
if (!setup || !seedTemplate) throw new Error('Reviewed minimal fixture missing');
const definitions = [...queueRepair.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$ ;/g)].map(match => match[0]);
if (definitions.length !== 2) throw new Error('Two contained queue RPCs required');
const signatures = [
  'public.ack_address_resolution_queue_item_v2(jsonb)',
  'public.get_claimed_address_resolution_item_v1(uuid,uuid)',
  'public.record_address_entity_candidates_v1(uuid,text,uuid,text,text,jsonb)',
];
const expectedHashes = [
  '6b729ae94fbb7aac38160d5a519479a6a1e17112ec6284d313b14be1959bdf4f',
  '9e2453050463d1b7e442d7fe5bb9e1a41e2bc2d01f6f5b140123df359f78eece',
  'd1ba244a46b5e94d534afb05508c5b609c2ab00d41728a0476db1d22d4b26a9d',
];
const values: Record<string, string> = {
  tenant: '10000000-0000-4000-8000-000000000001',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  queueId: '20000000-0000-4000-8000-000000000001',
  clientId: '30000000-0000-4000-8000-000000000001',
  canonicalId: '40000000-0000-4000-8000-000000000001',
  lease: '50000000-0000-4000-8000-000000000001',
  addressHash: 'a'.repeat(64),
};
const seed = seedTemplate.replace(/\$\{([A-Za-z]+)\}/g, (_match: string, name: string) => {
  if (!(name in values)) throw new Error('Unknown synthetic fixture binding');
  return values[name];
});
let db: PGlite;
const apply = async (sql: string) => {
  try { await db.exec(sql); }
  catch (error) { await db.exec('rollback'); throw error; }
};
const catalog = async () => Promise.all(signatures.map(async signature =>
  (await db.query<{ definition: string; owner: string; definer: boolean;
    config: string[]; acl: string }>(
    'select pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,'
    + 'p.prosecdef definer,p.proconfig config,p.proacl::text acl '
    + 'from pg_proc p where p.oid=to_regprocedure($1)', [signature],
  )).rows[0]));
const snapshot = async () => ({
  queue: (await db.query('select * from public.address_resolution_queue order by id')).rows,
  clients: (await db.query('select * from public.clients order by id')).rows,
  canonical: (await db.query('select * from public.canonical_addresses order by id')).rows,
});
const record = (hash = values.addressHash) => db.query(
  'select public.record_address_entity_candidates_v1($1,$2,$3,$4,$5,$6::jsonb)',
  [values.tenant, 'client', values.clientId, 'Synthetic fixture address', hash, '[]'],
);
beforeEach(async () => {
  db = new PGlite();
  await db.exec(setup);
  await db.exec('alter table public.address_resolution_queue alter column id set default gen_random_uuid();'
    + 'alter table public.address_resolution_queue add unique(tenant_id,entity_type,entity_id);');
  for (const definition of definitions) await db.exec(definition);
  for (const signature of signatures.slice(0, 2)) {
    await db.exec('revoke all on function ' + signature + ' from public,anon,authenticated,service_role;'
      + ' grant execute on function ' + signature + ' to service_role;');
  }
  await db.exec(legacyRecord);
  await apply(queueRepair);
  await apply(recordRepair);
}, 30_000);
afterEach(async () => { await db?.close(); });
describe('published address containment on the combined tree, PGlite RAM only', () => {
  it('executes complete guarded migrations and retains exact published bodies/ACL/invoker', async () => {
    const rows = await catalog();
    for (const [index, row] of rows.entries()) {
      expect(createHash('sha256').update(row.definition).digest('hex')).toBe(expectedHashes[index]);
      expect(row).toMatchObject({ owner: 'postgres', definer: false,
        config: ['search_path=""'], acl: '{postgres=X/postgres,service_role=X/postgres}' });
      expect(row.definition).not.toContain('40001');
      expect(row.definition).toContain('P0001');
    }
  });
  it('replays both complete repairs idempotently without changing bodies or data', async () => {
    const before = await catalog(), data = await snapshot();
    await apply(queueRepair); await apply(recordRepair);
    expect(await catalog()).toEqual(before); expect(await snapshot()).toEqual(data);
  });
  it('returns finite P0001 on an unavailable synthetic claim with no mutation', async () => {
    const before = await snapshot(); await db.exec('set role service_role');
    await expect(db.query('select public.get_claimed_address_resolution_item_v1($1,$2)',
      [values.queueId, values.lease])).rejects.toMatchObject({
      code: 'P0001', message: 'address_queue_claim_not_available',
    });
    await db.exec('reset role'); expect(await snapshot()).toEqual(before);
  });
  it('keeps stale subject rejection atomic with P0001 after the actual record repair', async () => {
    await db.exec(seed); const before = await snapshot();
    await expect(record('b'.repeat(64))).rejects.toMatchObject({
      code: 'P0001', message: 'address_subject_changed',
    });
    await db.exec('reset role'); expect(await snapshot()).toEqual(before);
  });
  it('keeps normal scoped record/queue status atomic after the repair', async () => {
    await db.exec(seed); await record(); await db.exec('reset role');
    expect((await db.query('select status,candidates,last_error from public.address_resolution_queue where id=$1',
      [values.queueId])).rows[0]).toEqual({ status: 'error', candidates: [], last_error: 'no_candidates' });
    expect((await db.query('select address_geocode_status from public.clients where id=$1',
      [values.clientId])).rows[0]).toEqual({ address_geocode_status: 'error' });
    expect((await db.query('select address_geocode_status from public.clients where tenant_id=$1',
      [values.otherTenant])).rows[0]).toEqual({ address_geocode_status: 'pending' });
  });
  it.each(['anon', 'authenticated'])('continues to deny %s execution', async role => {
    await db.exec('set role ' + role);
    await expect(db.query('select public.get_claimed_address_resolution_item_v1($1,$2)',
      [values.queueId, values.lease])).rejects.toMatchObject({ code: '42501' });
    await db.exec('reset role');
  });
  it('rejects an ACL drift before replacing any contained function', async () => {
    await db.exec('grant execute on function public.get_claimed_address_resolution_item_v1(uuid,uuid) to authenticated');
    const before = await catalog();
    await expect(apply(queueRepair)).rejects.toThrow('queue_containment_pre_definition_or_privilege_drift');
    expect(await catalog()).toEqual(before);
  });
  it('rejects a body drift without treating it as an approved migration input', async () => {
    await db.exec("create or replace function public.get_claimed_address_resolution_item_v1(_queue_id uuid,_lease_token uuid)"
      + " returns jsonb language plpgsql set search_path='' as $$begin return null; end$$;");
    const before = await catalog();
    await expect(apply(queueRepair)).rejects.toThrow('queue_containment_pre_definition_or_privilege_drift');
    expect(await catalog()).toEqual(before);
  });
  it('records actual ledger versions and excludes the historical 153500 proposal', () => {
    const files = readdirSync('supabase/migrations');
    expect(files).toContain('20261009151836_address_queue_business_errors_no_serialization_retry.sql');
    expect(files).toContain('20261009161011_address_candidate_business_errors_no_serialization_retry.sql');
    expect(files.some(name => name.startsWith('20261009153500_'))).toBe(false);
  });
});

