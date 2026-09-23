import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/hooks/useGenerateCTe.tsx', 'utf8');
const contextSql = readFileSync('supabase/migrations/20260921201540_atomic_fiscal_document_freight_update.sql', 'utf8');

describe('automatic CT-e fiscal context regressions', () => {
  it('reads every NF-e once and rejects ambiguous clients or destinations', () => {
    expect(source).toContain('readLoadFreightContext(currentTenant.id, load.id)');
    expect(contextSql).toContain('create or replace function public.get_load_freight_context_v1');
    expect(contextSql).toContain("'documents',coalesce((select jsonb_agg(");
    expect(source).toContain('clientIds.length > 1');
    expect(source).toContain('destinations.size > 1');
    expect(source).toContain('refDocs.reduce');
  });

  it('preserves the recipient fiscal identity from the reference NF-e', () => {
    expect(source).toContain('recipient: refDoc.recipient');
    expect(source).toContain('recipient_cnpj: refDoc.recipient_cnpj');
    expect(source).not.toContain("recipient: load.destination || 'Destino não informado'");
  });

  it('fails before inserting a confirmed CT-e when no active emitter exists', () => {
    const guard = source.indexOf("throw new Error('Cadastre e ative um emitente antes de gerar o CT-e.')");
    const insert = source.indexOf("create_fiscal_document_with_freight_v1");
    expect(guard).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(guard);
    expect(source).toContain('emitter_id: emitter.id');
    expect(source).toContain('remitter_cnpj: emitter.cnpj');
  });
});
