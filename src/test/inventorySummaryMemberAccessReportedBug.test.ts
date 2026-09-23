import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('inventory summary member access',()=>{
 it('aligns the summary authorization with inventory read policies',()=>{
  const migration=readFileSync('supabase/migrations/20260921181528_allow_inventory_summary_members.sql','utf8');
  expect(migration).toContain('public.is_tenant_member(_tenant_id)');
  expect(migration).not.toContain('public.is_tenant_admin(_tenant_id)');
 });
 it('treats a summary failure as a dashboard failure instead of zero inventory',()=>{
  const dashboard=readFileSync('src/pages/OperationsDashboard.tsx','utf8');
  expect(dashboard).toContain("{ name: 'saldos de estoque', query: inventoryQuery }");
  expect(dashboard).toContain('Nenhum indicador parcial será apresentado');
 });
});
