// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create function public.create_tenant_with_owner(text) returns uuid language sql security definer
      as $$select gen_random_uuid()$$;
    grant execute on function public.create_tenant_with_owner(text) to public,anon,authenticated,service_role;`);
  await db.exec(readFileSync('supabase/migrations/20260830013726_restrict_tenant_creation_to_platform.sql', 'utf8'));
}, 30000);
afterAll(async () => db?.close());

describe('tenant provisioning privilege boundary in PostgreSQL', () => {
  it.each(['anon','authenticated','service_role'])('denies legacy provisioning to %s including PUBLIC inheritance', async role => {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query("select public.create_tenant_with_owner('not-created')")).rejects.toMatchObject({ code:'42501' });
    } finally {
      await db.exec('reset role');
    }
  });
  it('retains database-owner access for controlled administration', async () => {
    expect((await db.query("select has_function_privilege(current_user,'public.create_tenant_with_owner(text)','execute') as allowed")).rows).toEqual([{allowed:true}]);
  });
});
