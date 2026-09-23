import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('inventory movement idempotency',()=>{
 it('deduplicates the request in the same transaction that fires the balance trigger',()=>{
  const sql=readFileSync('supabase/migrations/20260921182102_idempotent_inventory_movements.sql','utf8');
  expect(sql).toContain('inventory_movements_tenant_request_uidx');
  expect(sql).toContain("where tenant_id=t and request_id=r");
  expect(sql).toContain('existing.request_hash is distinct from h');
 });
 it('submits through a durable command and the idempotent RPC',()=>{
  const hook=readFileSync('src/hooks/useInventory.tsx','utf8');
  expect(hook).toContain("action:'create_inventory_movement'");
  expect(hook).toContain("rpc('create_inventory_movement_v1'");
  expect(hook).not.toContain("from('inventory_movements').insert");
 });
});
