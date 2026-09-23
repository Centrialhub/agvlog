import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Ingestion.tsx','utf8');

describe('falhas posteriores à criação na ingestão',()=>{
  it('não silencia falha ao cadastrar destinatário',()=>{
    expect(page).toContain('Falha ao cadastrar o destinatário');
    expect(page).toContain('O cadastro do destinatário');
    expect(page).not.toMatch(/catch \{\s*return null;\s*\}/);
    expect(page).toContain('não pôde ser identificado ou cadastrado');
  });

  it('mantém a NF criada como sucesso e relata auditoria pendente separadamente',()=>{
    expect(page).toContain('const recordPostCreateAudits = async');
    expect(page).toContain('warnings.push(`log de frete:');
    expect(page).toContain('warnings.push(`auditoria ORT:');
    expect(page).toContain('✅ NF ${doc.source.invoiceNumber} salva${freightLabel}${auditLabel}');
    expect(page).toContain('✅ NF ${doc.source.invoiceNumber} importada${freightLabel}${auditLabel}');
    expect(page).toContain('createdDocIds.set(getValidatedDocKey(doc), created.id)');
  });
});
