// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrations = [
  ['20260830061800_restrict_idempotency_key_read_scope.sql', 'v_membership_helper_hash'],
  ['20260830062933_harden_dispatch_planned_route.sql', 'v_authorization_hash'],
  ['20260830072744_harden_load_composition_integrity.sql', 'v_authorization_hash'],
  ['20260830080608_add_explicit_load_replanning.sql', 'v_observed_hash'],
  ['20260830085557_harden_document_composition_changes.sql', 'v_observed_hash'],
] as const;

function operatorHelper(filename: string) {
  const source = readFileSync(`supabase/migrations/${filename}`, 'utf8');
  const start = source.toLowerCase().indexOf('function public.is_tenant_operator_or_admin(');
  const end = source.indexOf('$function$;', start) + '$function$;'.length;
  if (start < 0 || end < '$function$;'.length) throw new Error(`Missing helper in ${filename}`);
  return `create or replace ${source.slice(start, end)}`;
}

function actualGuard(filename: string, variable: string) {
  const source = readFileSync(`supabase/migrations/${filename}`, 'utf8');
  const start = source.indexOf(`${variable} := md5(`);
  const end = source.indexOf('end if;', start) + 'end if;'.length;
  if (start < 0 || end < 'end if;'.length) throw new Error(`Missing guard in ${filename}`);
  const guard = source.slice(start, end);
  if (variable === 'v_observed_hash') {
    return `do $guard$ declare c record; v_observed_hash text; begin
      select 'public.is_tenant_operator_or_admin(uuid)'::text as signature,
        '682f66029dc9bb798f9f329b4e8f95aa'::text as hash into c;
      ${guard} end $guard$;`;
  }
  return `do $guard$ declare ${variable} text; begin ${guard} end $guard$;`;
}

describe('historical operator authorization preflights', () => {
  it('accepts only the two reviewed chronological helper definitions', async () => {
    const db = new PGlite();
    try {
      await db.exec(`create schema auth;
        create function auth.uid() returns uuid language sql as $$select null::uuid$$;
        create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
        create table public.tenant_memberships(user_id uuid,tenant_id uuid,active boolean,role text);`);
      for (const [filename, variable] of migrations) {
        const guard = actualGuard(filename, variable);
        for (const helper of [
          '20260828160000_remove_privileged_mfa.sql',
          '20260828210458_enforce_privileged_mfa_release.sql',
        ]) {
          await db.exec(operatorHelper(helper));
          await expect(db.exec(guard)).resolves.toBeDefined();
        }
        await db.exec('alter function public.is_tenant_operator_or_admin(uuid) set search_path=public');
        const observed = (await db.query<{ hash: string }>(`select md5(replace(
          pg_get_functiondef('public.is_tenant_operator_or_admin(uuid)'::regprocedure),E'\\r\\n',E'\\n')) hash`)).rows[0].hash;
        expect(observed).not.toBe('1345468a366a7b0b9ae62d3ec4825232');
        expect(observed).not.toBe('682f66029dc9bb798f9f329b4e8f95aa');
        await expect(db.exec(guard)).rejects.toThrow(new RegExp(`observed hash:? ${observed}`));
      }
    } finally {
      await db.close();
    }
  }, 30000);
});
