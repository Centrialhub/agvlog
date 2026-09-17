// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917144500_make_inventory_movements_immutable.sql',
  'utf8',
);
const tenant = '21000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create function public.is_tenant_admin(_tenant_id uuid) returns boolean language sql stable as $$select true$$;
    create table public.inventory_movements(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      item_description text not null,
      quantity numeric not null
    );
    create table public.inventory_balances(
      tenant_id uuid not null,
      item_description text not null,
      quantity numeric not null,
      primary key(tenant_id,item_description)
    );
    create function public.qa_update_inventory_balance() returns trigger language plpgsql as $$
    begin
      insert into public.inventory_balances values(new.tenant_id,new.item_description,new.quantity)
      on conflict(tenant_id,item_description) do update
      set quantity=public.inventory_balances.quantity+excluded.quantity;
      return new;
    end$$;
    create trigger trg_inventory_movement_balance after insert on public.inventory_movements
    for each row execute function public.qa_update_inventory_balance();
    alter table public.inventory_movements enable row level security;
    create policy "Admins can manage inventory_movements" on public.inventory_movements
    for all to authenticated using(public.is_tenant_admin(tenant_id)) with check(public.is_tenant_admin(tenant_id));
    grant select,insert,update,delete on public.inventory_movements to authenticated;
    insert into public.inventory_movements(tenant_id,item_description,quantity)
    values('${tenant}','Pallet PBR',10);
  `);
  await db.exec(migration);
});

afterAll(async () => {
  await db?.close();
});

describe('immutable inventory movement history', () => {
  it('rejects updates and deletes without drifting the balance', async () => {
    await expect(db.exec('update public.inventory_movements set quantity=99')).rejects.toThrow('inventory_movement_history_is_immutable');
    await expect(db.exec('delete from public.inventory_movements')).rejects.toThrow('inventory_movement_history_is_immutable');
    expect((await db.query('select quantity from public.inventory_movements')).rows[0]).toEqual({ quantity: '10' });
    expect((await db.query('select quantity from public.inventory_balances')).rows[0]).toEqual({ quantity: '10' });
  });

  it('removes authenticated update/delete privileges and the ALL policy', async () => {
    expect((await db.query(`select
      has_table_privilege('authenticated','public.inventory_movements','insert') can_insert,
      has_table_privilege('authenticated','public.inventory_movements','update') can_update,
      has_table_privilege('authenticated','public.inventory_movements','delete') can_delete`)).rows[0])
      .toEqual({ can_insert: true, can_update: false, can_delete: false });
    expect((await db.query(`select cmd from pg_policies where schemaname='public' and tablename='inventory_movements'`)).rows)
      .toEqual([{ cmd: 'INSERT' }]);
  });
});
