import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useFiscalDocuments.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260921201540_atomic_fiscal_document_freight_update.sql','utf8');

describe('edição e recálculo atômicos do CT-e',()=>{
  it('calcula antes da escrita e confirma documento, frete e log em uma RPC',()=>{
    expect(hook).toContain("rpc('update_fiscal_document_with_freight_v1'");
    expect(hook).not.toContain("console.warn('[useUpdateFiscalDocument] auto-recalc falhou'");
    expect(migration).toContain('insert into public.freight_calculation_log');
  });

  it('usa a revisão lida para rejeitar resultado obsoleto',()=>{
    expect(hook).toContain('_expected_updated_at:current.updated_at');
    expect(migration).toContain('target.updated_at=$5');
    expect(migration).toContain("raise exception 'fiscal_document_changed'");
  });

  it('cria e recalcula CT-e junto com a auditoria',()=>{
    const generate=readFileSync('src/hooks/useGenerateCTe.tsx','utf8');
    const recalculate=readFileSync('src/hooks/useRecalculateCTeFreight.tsx','utf8');
    expect(generate).toContain("rpc('create_fiscal_document_with_freight_v1'");
    expect(recalculate).toContain("rpc('update_fiscal_document_with_freight_v1'");
    expect(generate).not.toContain('logFreightCalculation');
    expect(recalculate).not.toContain('logFreightCalculation');
    expect(migration).toContain('create or replace function public.create_fiscal_document_with_freight_v1');
    expect(migration).toContain("_tenant_id,'cte',v_document_id");
  });
});
