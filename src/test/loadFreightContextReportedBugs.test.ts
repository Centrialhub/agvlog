import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921201540_atomic_fiscal_document_freight_update.sql','utf8');
const helper=readFileSync('src/lib/fiscalDocuments/loadFreightContext.ts','utf8');
const generation=readFileSync('src/hooks/useGenerateCTe.tsx','utf8');
const recalculation=readFileSync('src/hooks/useRecalculateCTeFreight.tsx','utf8');
const documents=readFileSync('src/hooks/useFiscalDocuments.tsx','utf8');

describe('base vigente e completa para o frete do CT-e',()=>{
  it('exclui NF-e cancelada e exige vínculo na projeção vigente',()=>{
    expect(migration).toContain("f.status<>'cancelled'");
    expect(migration).toContain('from public.current_load_items i');
    expect(migration).toContain('i.fiscal_document_id=f.id');
  });

  it('agrega no servidor sem teto de linhas da API',()=>{
    expect(helper).toContain("rpc('get_load_freight_context_v1'");
    expect(migration).toContain("'documents',coalesce((select jsonb_agg");
    expect(migration).toContain("'total_pallets',coalesce((select sum");
    expect(generation).toContain('readLoadFreightContext(currentTenant.id, load.id)');
    expect(recalculation).toContain('readLoadFreightContext(currentTenant.id, cte.load_id)');
    expect(documents).toContain('readLoadFreightContext(currentTenant.id, doc.load_id)');
    expect(generation).not.toContain(".from('load_items')");
    expect(generation).not.toContain(".from('load_orders')");
  });
});
