import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260928182208_restrict_internal_trigger_execute.sql', import.meta.url), 'utf8');
const functions = ['guard_freight_table_overlap', 'guard_reported_catalog_values', 'guard_shortage_status_values',
  'protect_imported_note_status_v1', 'protect_tenant_owners', 'record_nfse_created_event_v1',
  'record_return_sheet_signed_proof_v1', 'validate_trip_stop_poi_tenant_v1'];

async function fixture(t, { missing = false, wrongReturn = false, wrongOwner = false, overload = false } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE unrelated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, unrelated;
    CREATE FUNCTION public.unrelated_rpc() RETURNS int LANGUAGE sql AS $$ SELECT 42 $$;`);
  for (const [index, name] of functions.entries()) {
    if (missing && index === functions.length - 1) continue;
    await db.exec(`CREATE TABLE public.trigger_fixture_${index}(value integer);
      GRANT INSERT, SELECT ON public.trigger_fixture_${index} TO anon, authenticated, service_role;
      CREATE FUNCTION public.${name}() RETURNS ${wrongReturn && index === functions.length - 1 ? 'integer' : 'trigger'}
      LANGUAGE plpgsql ${index % 2 === 0 ? 'SECURITY DEFINER' : 'SECURITY INVOKER'} SET search_path = ''
      AS $$ BEGIN ${wrongReturn && index === functions.length - 1 ? 'RETURN 1;' : 'NEW.value := NEW.value + 1; RETURN NEW;'} END $$;
      ALTER FUNCTION public.${name}() OWNER TO postgres;`);
    if (!(wrongReturn && index === functions.length - 1)) await db.exec(`CREATE TRIGGER existing_trigger BEFORE INSERT
      ON public.trigger_fixture_${index} FOR EACH ROW EXECUTE FUNCTION public.${name}();`);
  }
  if (wrongOwner) await db.exec(`ALTER FUNCTION public.${functions.at(-1)}() OWNER TO unrelated;`);
  if (overload) await db.exec(`CREATE FUNCTION public.${functions[0]}(value integer) RETURNS integer LANGUAGE sql AS $$ SELECT value $$;`);
  return db;
}

async function permissions(db) {
  return (await db.query(`SELECT p.oid::regprocedure::text AS signature, p.proacl::text AS acl,
    pg_get_functiondef(p.oid) AS definition, pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' ORDER BY signature`)).rows;
}

test('revokes only eight exact trigger signatures and preserves invocation through existing triggers', async (t) => {
  const db = await fixture(t, { overload: true });
  // Exercise inherited PUBLIC and explicit grants; unrelated permissions are preserved.
  await db.exec(`GRANT EXECUTE ON FUNCTION public.${functions[0]}() TO anon, authenticated, service_role, unrelated;`);
  const before = await permissions(db);
  const triggersBefore = (await db.query('SELECT oid, tgfoid, tgrelid, tgenabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger ORDER BY oid')).rows;
  await db.exec(migration);
  const after = await permissions(db);
  for (const original of before) {
    const actual = after.find((item) => item.signature === original.signature);
    assert.equal(actual.definition, original.definition);
    assert.equal(actual.owner, original.owner);
    if (!functions.some((name) => original.signature === `${name}()`)) assert.equal(actual.acl, original.acl);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const [index, name] of functions.entries()) {
      assert.equal((await db.query(`SELECT has_function_privilege('${role}', 'public.${name}()', 'EXECUTE') AS allowed`)).rows[0].allowed, false);
      await assert.rejects(db.exec(`SET ROLE ${role}; SELECT public.${name}();`), /permission denied for function/);
      await db.exec('RESET ROLE');
      await db.exec(`SET ROLE ${role}; INSERT INTO public.trigger_fixture_${index}(value) VALUES (10); RESET ROLE;`);
    }
  }
  for (let index = 0; index < functions.length; index += 1) {
    assert.deepEqual((await db.query(`SELECT value FROM public.trigger_fixture_${index}`)).rows, [{ value: 11 }, { value: 11 }, { value: 11 }]);
  }
  assert.equal((await db.query(`SELECT has_function_privilege('unrelated', 'public.${functions[0]}()', 'EXECUTE') AS allowed`)).rows[0].allowed, true);
  assert.equal((await db.query(`SELECT count(*)::int AS public_grants FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
    WHERE p.oid=ANY($1::regprocedure[]) AND a.grantee=0 AND a.privilege_type='EXECUTE'`, [functions.map((name) => `public.${name}()`)] )).rows[0].public_grants, 0);
  assert.deepEqual((await db.query('SELECT oid, tgfoid, tgrelid, tgenabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger ORDER BY oid')).rows, triggersBefore);
  await db.exec(migration);
  assert.deepEqual(await permissions(db), after);
});

for (const [name, options] of [['missing signature', { missing: true }], ['non-trigger return type', { wrongReturn: true }], ['changed owner', { wrongOwner: true }]]) {
  test(`preflight rejects ${name} without changing an earlier function ACL`, async (t) => {
    const db = await fixture(t, options);
    const before = await permissions(db);
    await assert.rejects(db.exec(migration), /Internal trigger ACL preflight failed/);
    assert.deepEqual(await permissions(db), before);
  });
}

test('an unexpected inherited client grant aborts the entire ACL operation without broad revokes', async (t) => {
  const db = await fixture(t);
  await db.exec(`GRANT unrelated TO authenticated;
    GRANT EXECUTE ON FUNCTION public.${functions.at(-1)}() TO unrelated;`);
  const before = await permissions(db);
  await assert.rejects(db.exec(migration), /Internal trigger ACL verification failed/);
  assert.deepEqual(await permissions(db), before);
});
