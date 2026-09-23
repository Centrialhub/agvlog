import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useFiscalDocuments.tsx','utf8');
const ingestion=readFileSync('src/pages/Ingestion.tsx','utf8');
const nfse=readFileSync('src/components/nfse/NFSeFormDialog.tsx','utf8');

describe('catálogo legado completo de documentos fiscais',()=>{
  it('percorre todas as páginas em ordem total estável',()=>{
    const reader=hook.slice(hook.indexOf('export function useFiscalDocuments()'),hook.indexOf('export function useCreateFiscalDocument()'));
    expect(reader).toContain('fetchAllPostgrestPages<FiscalDocument>');
    expect(reader).toContain(".order('created_at', { ascending: false })");
    expect(reader).toContain(".order('id', { ascending: false })");
    expect(reader).toContain('.range(from,to)');
  });

  it('mantém Ingestão e NFS-e consumindo o catálogo corrigido',()=>{
    expect(ingestion).toContain('useFiscalDocuments()');
    expect(nfse).toContain('useFiscalDocuments()');
  });
});
