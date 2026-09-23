// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922039000_make_poi_dedupe_conflict_inferable.sql',
  'utf8',
);

describe('deduplicação inferível de POIs', () => {
  it('permite upsert por tenant/chave e continua aceitando várias chaves nulas', async () => {
    const db = new PGlite();
    await db.exec(`
      create table public.pois (
        id uuid primary key,
        tenant_id uuid not null,
        dedupe_key text,
        name text not null
      );
      create unique index idx_pois_tenant_dedupe
        on public.pois (tenant_id, dedupe_key) where dedupe_key is not null;
    `);
    await db.exec(migration);
    const tenant = '10000000-0000-4000-8000-000000000001';
    await db.query("insert into pois values('20000000-0000-4000-8000-000000000001',$1,null,'Sem chave 1'),('20000000-0000-4000-8000-000000000002',$1,null,'Sem chave 2')", [tenant]);
    await db.query("insert into pois values('20000000-0000-4000-8000-000000000003',$1,'coord','Primeiro') on conflict(tenant_id,dedupe_key) do update set name=excluded.name", [tenant]);
    await db.query("insert into pois values('20000000-0000-4000-8000-000000000004',$1,'coord','Atualizado') on conflict(tenant_id,dedupe_key) do update set name=excluded.name", [tenant]);
    expect((await db.query<{ name: string }>("select name from pois where dedupe_key='coord'")).rows).toEqual([{ name: 'Atualizado' }]);
    expect((await db.query<{ count: number }>('select count(*)::int count from pois where dedupe_key is null')).rows[0].count).toBe(2);
    await db.close();
  });
});
