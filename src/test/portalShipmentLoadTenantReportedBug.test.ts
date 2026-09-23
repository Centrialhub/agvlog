import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('escopo da carga projetada no portal', () => {
  it('restringe o join ao tenant e impede novos vínculos cruzados', () => {
    const sql = readFileSync('supabase/migrations/20260921125500_enforce_fiscal_load_tenant_scope.sql', 'utf8');
    expect(sql).toContain('ON l.id = fd.load_id AND l.tenant_id = fd.tenant_id');
    expect(sql).toContain('foreign key (load_id, tenant_id)');
    expect(sql).toContain('references public.loads (id, tenant_id)');
    expect(sql).toContain('not valid');
  });
});
