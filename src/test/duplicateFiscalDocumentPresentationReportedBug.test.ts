import { describe, expect, it } from 'vitest';
import { DuplicateFiscalDocumentError, formatFiscalDocumentError } from '@/lib/fiscalDocuments/fiscalIdentity';

describe('apresentação de nota fiscal duplicada',()=>{
  it('mostra a mensagem em português e os dados recuperados da nota existente',()=>{
    const error=new DuplicateFiscalDocumentError({
      remitter:'Fornecedor QA',remitter_cnpj:'12.345.678/0001-90',invoice_number:'123',invoice_series:'4',fiscal_model:'55',access_key:'3526',
    });
    expect(formatFiscalDocumentError(error)).toBe('Esta nota fiscal já está cadastrada. • Fornecedor: Fornecedor QA • CNPJ: 12.345.678/0001-90 • Nota: 123 • Série: 4 • Modelo: 55 • Chave: 3526');
  });

  it('preserva mensagens comuns e fallback',()=>{
    expect(formatFiscalDocumentError(new Error('Falha de rede'))).toBe('Falha de rede');
    expect(formatFiscalDocumentError(null,'Falha alternativa')).toBe('Falha alternativa');
  });
});
