import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('inventory movement tenant dates',()=>{
 it('passes the tenant timezone and uses an exclusive next-day boundary',()=>{
  const hook=readFileSync('src/hooks/useInventory.tsx','utf8');
  const migration=readFileSync('supabase/migrations/20260921180910_search_inventory_relations.sql','utf8');
  expect(hook).toContain('_timezone:currentTenant.timezone');
  expect(migration).toContain("(_from::timestamp at time zone _timezone)");
  expect(migration).toContain("((_to+1)::timestamp at time zone _timezone)");
  expect(migration).not.toContain('T23:59:59.999');
 });
});
