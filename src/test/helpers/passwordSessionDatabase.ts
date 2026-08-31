import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';

export const passwordSessionSql = readFileSync(
  'supabase/migrations/20260831164442_remove_authenticator_requirement.sql', 'utf8',
);
export const passwordSessionDefinitions = [...passwordSessionSql.matchAll(
  /create or replace function\s+([\w.]+)\s*\([\s\S]*?\bas\s+(\$[A-Za-z_]*\$)[\s\S]*?\2;/gi,
)];

// Historical fixtures reproduce earlier releases. Apply the actual forward
// definitions for the subsystem present and verify that its ACLs stay intact.
export async function installPasswordSessionFixture(db: PGlite) {
  const installed: string[] = [];
  for (const match of passwordSessionDefinitions) {
    const [schema, name] = match[1].split('.');
    const {rows} = await db.query<{present: boolean}>(
      'select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2) present',
      [schema, name],
    );
    if (rows[0].present) {
      const aclQuery = 'select p.proacl, p.prosecdef, p.proconfig, p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 order by p.oid';
      const before = await db.query(aclQuery, [schema, name]);
      await db.exec(match[0]);
      const after = await db.query(aclQuery, [schema, name]);
      if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw new Error('Authorization metadata changed for '+match[1]);
      installed.push(match[1]);
    }
  }
  await db.exec('drop function if exists public.session_has_privileged_mfa_v1(uuid)');
  await db.exec(passwordSessionSql.slice(passwordSessionSql.indexOf('do $check$')));
  return installed;
}
