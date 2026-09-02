// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDeliveryDatabase,
  deliveryDetails,
  deliveryIds as ids,
  seedDelivery,
} from './helpers/deliveryDatabase';

const migration = readFileSync(
  'supabase/migrations/20260902010806_retire_legacy_driver_delivery_browser_acl.sql',
  'utf8',
);
const signatures = [
  'public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)',
  'public.driver_update_stop_status(uuid,text,text)',
] as const;
const remoteCanonicalSourceHashes = {
  'driver_finalize_delivery(uuid,text,text,text[],text,text,text)': 'b94b098acff621dddcfbfd0232565c07',
  'driver_update_stop_status(uuid,text,text)': 'ed77f6d5eea53eeb282edfc9a4736c50',
  'finalize_driver_delivery(uuid,text,text,text[],uuid)': '0fc748c47fa464c9781d77518f2c1434',
} as const;

let db: PGlite;

async function access(signature: string) {
  return (await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select
    has_function_privilege('anon',$1,'execute') anon,
    has_function_privilege('authenticated',$1,'execute') authenticated,
    has_function_privilege('service_role',$1,'execute') service`, [signature])).rows[0];
}

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' || entry.name === 'migrations' ? [] : runtimeSources(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

beforeEach(async () => {
  db = await createDeliveryDatabase();
  await seedDelivery(db);
});

afterEach(async () => db?.close());

describe('legacy driver delivery browser ACL closure', () => {
  it('removes browser execution while preserving the service compatibility path', async () => {
    const lineEndings = (await db.query<{ crlf_to_lf: boolean; standalone_cr_preserved: boolean }>(`
      select
        replace(E'a\\r\\nb', chr(13) || chr(10), chr(10)) = E'a\\nb' crlf_to_lf,
        replace(E'a\\rb', chr(13) || chr(10), chr(10)) = E'a\\rb' standalone_cr_preserved
    `)).rows[0];
    expect(lineEndings).toEqual({ crlf_to_lf: true, standalone_cr_preserved: true });

    const canonicalHashes = await db.query<{ signature: keyof typeof remoteCanonicalSourceHashes; hash: string }>(`
      select oid::regprocedure::text signature,
        md5(replace(prosrc, chr(13) || chr(10), chr(10))) hash
      from pg_proc
      where oid in (
        to_regprocedure('public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)'),
        to_regprocedure('public.driver_update_stop_status(uuid,text,text)'),
        to_regprocedure('public.finalize_driver_delivery(uuid,text,text,text[],uuid)')
      )`);
    expect(Object.fromEntries(canonicalHashes.rows.map(({ signature, hash }) => [signature, hash])))
      .toEqual(remoteCanonicalSourceHashes);

    await db.exec(migration);

    for (const signature of signatures) {
      expect(await access(signature)).toEqual({ anon: false, authenticated: false, service: true });
    }

    await db.exec('set role authenticated');
    await expect(db.query('select public.driver_finalize_delivery($1,$2,$3,$4::text[])', [
      ids.stop,
      deliveryDetails.receiver_name,
      deliveryDetails.signature_path,
      deliveryDetails.photo_paths,
    ])).rejects.toMatchObject({ code: '42501' });

    await db.exec('reset role; set role service_role');
    const result = await db.query<{ result: { updated_stop_id: string; replayed: boolean } }>(
      'select public.driver_finalize_delivery($1,$2,$3,$4::text[]) result',
      [ids.stop, deliveryDetails.receiver_name, deliveryDetails.signature_path, deliveryDetails.photo_paths],
    );
    expect(result.rows[0].result).toMatchObject({ updated_stop_id: ids.stop, replayed: false });
  });

  it.each([
    ['driver_finalize_delivery', `create or replace function public.driver_finalize_delivery(
      _stop_id uuid, _receiver_name text, _signature_path text default null,
      _photo_paths text[] default array[]::text[], _receiver_document text default null,
      _receiver_role text default null, _notes text default null
    ) returns jsonb language sql security definer set search_path=''
      as $$select jsonb_build_object('mutated', true)$$`],
    ['driver_update_stop_status', `create or replace function public.driver_update_stop_status(
      _stop_id uuid, _new_status text, _reason text default null
    ) returns jsonb language sql security definer set search_path=''
      as $$select jsonb_build_object('mutated', true)$$`],
    ['finalize_driver_delivery', `create or replace function public.finalize_driver_delivery(
      _stop_id uuid, _receiver_name text, _signature_path text default null,
      _photo_paths text[] default array[]::text[], _fiscal_document_id uuid default null
    ) returns jsonb language sql security definer set search_path=''
      as $$select jsonb_build_object('mutated', true)$$`],
  ])('fails closed on semantic drift in %s without partially revoking', async (_name, mutation) => {
    await db.exec(mutation);

    await expect(db.exec(migration)).rejects.toThrow(/changed before (ACL|browser ACL) closure/);
    await db.exec('rollback');
    for (const signature of signatures) {
      expect((await access(signature)).authenticated).toBe(true);
    }
  });

  it('fails closed unless both canonical delivery RPCs remain available to drivers', async () => {
    await db.exec(`revoke execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)
      from authenticated`);

    await expect(db.exec(migration)).rejects.toThrow('Canonical driver delivery RPC is not ready');
    await db.exec('rollback');
    for (const signature of signatures) {
      expect((await access(signature)).authenticated).toBe(true);
    }
  });

  it('fails closed when a new SQL function caller appears', async () => {
    await db.exec(`create function public.unexpected_driver_delivery_caller(_stop_id uuid)
      returns jsonb language sql security invoker set search_path=''
      as $$select public.driver_update_stop_status(_stop_id, 'arrived')$$`);

    await expect(db.exec(migration)).rejects.toThrow('gained an SQL function caller');
    await db.exec('rollback');
    for (const signature of signatures) {
      expect((await access(signature)).authenticated).toBe(true);
    }
  });

  it('has no current frontend, Edge Function or E2E caller for either retired browser RPC', () => {
    const roots = ['src', 'supabase/functions', 'e2e'];
    const callers = roots.flatMap((root) => runtimeSources(root))
      .filter((path) => path !== join('src', 'integrations', 'supabase', 'types.ts'))
      .filter((path) => /driver_finalize_delivery|driver_update_stop_status/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path).replace(/\\/g, '/'));
    expect(callers).toEqual([]);
  });

  it('uses exact signatures and does not introduce a blanket function revoke', () => {
    expect(migration).not.toMatch(/revoke\s+execute\s+on\s+all\s+functions/i);
    expect(migration).not.toMatch(/alter\s+default\s+privileges/i);
    expect(migration).toContain('pg_catalog.chr(13) || pg_catalog.chr(10)');
    expect(migration).toContain('pg_catalog.chr(10)');
    for (const signature of signatures) expect(migration).toContain(signature);
  });
});
