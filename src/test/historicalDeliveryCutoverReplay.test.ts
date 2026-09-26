// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRedeliveryDatabase } from './helpers/redeliveryDatabase';

const compositionAcl = readFileSync(
  'supabase/migrations/20260901001442_revoke_reintroduced_legacy_composition_acl.sql', 'utf8');
const cutover = readFileSync(
  'supabase/migrations/20260901002245_cutover_legacy_driver_delivery_writers.sql', 'utf8');
const replayHashes = [
  ['assign_fiscal_documents_to_load(uuid,uuid,uuid[])', '73793256599bf96b8232ddc15a68d166'],
  ['remove_fiscal_documents_from_load(uuid,uuid,uuid[])', '151cc5f78065f8cbce15464d9d088933'],
  ['assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', '6ee516b30bc6d8fb5acdfd3a7820c9a4'],
  ['remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'c2220961533993d755e6cae225c402ca'],
  ['_delivery_result_from_statuses(text[])', '2acc28ff3b14abf6153a535f8b3c23f6'],
  ['_derive_driver_delivery_result(uuid,uuid)', 'e34be4cc878f3367b67e0528dc38aae0'],
  ['_lock_delivery_trip_graph(uuid,uuid)', '09d1f26d159716d66c588457e02cccd2'],
  ['driver_record_delivery_note(uuid,text,jsonb,uuid)', 'a30ddc4e484cd3c66b26c57080965726'],
  ['driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)', 'd7cf0a8888b3ecbfef5105efa2685ad5'],
] as const;

function stagedCutoverPreflight() {
  const marker = 'for v_contract in select * from (values';
  const first = cutover.indexOf(marker);
  const start = cutover.indexOf(marker, first + marker.length);
  const end = cutover.indexOf('end loop;', start) + 'end loop;'.length;
  if (first < 0 || start < 0 || end < 'end loop;'.length) throw new Error('Staged cutover guard missing');
  return `do $probe$ declare v_contract record;v_observed_hash text;
    begin ${cutover.slice(start, end)} end;$probe$;`;
}

describe('chronological delivery replay guards', () => {
  it('accepts rewritten functions, preserves ACL repair, and rejects staged drift', async () => {
    const { db } = await createRedeliveryDatabase();
    try {
      for (const [signature, expected] of replayHashes) {
        const actual = (await db.query<{ hash: string }>(`select md5(replace(
          pg_get_functiondef($1::regprocedure),E'\\r\\n',E'\\n')) hash`, [`public.${signature}`])).rows[0].hash;
        expect(actual, signature).toBe(expected);
      }

      await db.exec(compositionAcl);
      for (const signature of replayHashes.slice(0, 2)) {
        expect((await db.query<{ allowed: boolean }>(
          'select has_function_privilege($1,$2,$3) allowed',
          ['authenticated', `public.${signature[0]}`, 'execute'])).rows[0].allowed).toBe(false);
      }

      const stagedGuard = stagedCutoverPreflight();
      await db.exec(stagedGuard);
      await db.exec('alter function public._derive_driver_delivery_result(uuid,uuid) set search_path=public');
      const observed = (await db.query<{ hash: string }>(`select md5(replace(
        pg_get_functiondef('public._derive_driver_delivery_result(uuid,uuid)'::regprocedure),chr(13),'')) hash`)).rows[0].hash;
      await expect(db.exec(stagedGuard)).rejects.toThrow(
        `Staged API contract changed: public._derive_driver_delivery_result(uuid,uuid); observed hash ${observed}`);

      await db.exec('alter function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) set search_path=public');
      const wrapperHash = (await db.query<{ hash: string }>(`select md5(replace(
        pg_get_functiondef('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])'::regprocedure),
        E'\\r\\n',E'\\n')) hash`)).rows[0].hash;
      await expect(db.exec(compositionAcl)).rejects.toThrow(
        `Composition ACL dependency changed: public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]); observed hash ${wrapperHash}`);
    } finally {
      await db.close();
    }
  }, 60000);
});
