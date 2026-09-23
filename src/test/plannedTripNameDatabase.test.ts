// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create table public.dispatch_trips(id integer generated always as identity primary key,status text not null,notes text)');
  await db.exec(readFileSync('supabase/migrations/20260923144654_require_nonempty_planned_trip_names.sql', 'utf8'));
  await db.exec(`create trigger require_planned_dispatch_route_name_v1
    before insert or update of notes,status on public.dispatch_trips
    for each row execute function public.require_planned_dispatch_route_name_v1()`);
}, 15000);
afterAll(async () => { await db?.close(); });

describe('planned trip name write boundary', () => {
  it('rejects missing and whitespace-only names, including status transitions', async () => {
    await expect(db.query("insert into public.dispatch_trips(status,notes) values('planned',null)")).rejects.toThrow('route_name_required');
    await expect(db.query("insert into public.dispatch_trips(status,notes) values('planned','   ')")).rejects.toThrow('route_name_required');
    const draft = await db.query<{id:number}>("insert into public.dispatch_trips(status,notes) values('draft',null) returning id");
    await expect(db.query("update public.dispatch_trips set status='planned' where id=$1", [draft.rows[0].id])).rejects.toThrow('route_name_required');
  });

  it('trims a valid name before persisting', async () => {
    const result = await db.query<{notes:string}>("insert into public.dispatch_trips(status,notes) values('planned','  Rota Norte  ') returning notes");
    expect(result.rows[0].notes).toBe('Rota Norte');
  });
});
