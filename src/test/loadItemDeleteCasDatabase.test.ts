// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createItemWriterDatabase, itemWriterIds as i, seedItemWriter } from './helpers/loadItemWriterDatabase';
import { compositionRpc } from './helpers/compositionDatabase';

let db: PGlite;
const manualItem = '81000000-0000-4000-8000-000000000001';
const migration = readFileSync('supabase/migrations/20260921113000_delete_load_item_with_expected_state.sql', 'utf8');

beforeAll(async () => { db = await createItemWriterDatabase(); await db.exec(migration); }, 30_000);
beforeEach(async () => {
  await seedItemWriter(db);
  await db.query("insert into load_items(id,tenant_id,load_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status) values($1,$2,$3,'Item manual',1,1,10,0,'pending')", [manualItem, i.tenant, i.load]);
});
afterAll(async () => { await db?.close(); });

async function expected() {
  return (await db.query<{ value: unknown }>(`select jsonb_build_object(
    'order_id',order_id,'item_description',item_description,'quantity',quantity,'pallet_count',pallet_count,
    'weight_kg',weight_kg,'volume_m3',volume_m3,'status',status,'notes',notes,'updated_at',updated_at
  ) value from load_items where id=$1`, [manualItem])).rows[0].value;
}

describe('exclusão CAS de item manual', () => {
  it('exclui somente o estado exato visualizado', async () => {
    const snapshot = await expected();
    await compositionRpc(db, 'select delete_load_item_v4($1,$2,$3) result', [i.tenant, manualItem, snapshot]);
    expect((await db.query('select count(*)::int n from load_items where id=$1', [manualItem])).rows[0]).toEqual({ n: 0 });
  });

  it('preserva uma edição concorrente e rejeita o snapshot antigo', async () => {
    const snapshot = await expected();
    await db.query("update load_items set item_description='Correção concorrente' where id=$1", [manualItem]);
    await expect(compositionRpc(db, 'select delete_load_item_v4($1,$2,$3)', [i.tenant, manualItem, snapshot])).rejects.toThrow('expected_changed');
    expect((await db.query('select item_description from load_items where id=$1', [manualItem])).rows[0]).toEqual({ item_description: 'Correção concorrente' });
  });
});
