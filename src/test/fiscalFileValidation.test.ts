import { describe, expect, it } from 'vitest';
import { validateFiscalBlob } from '@/lib/fiscal/fiscalFileValidation';
import { isFiscalFileHeaderValid } from '../../supabase/functions/_shared/fiscal-file-validation';

const xmlFixtures = [
  { name: 'NFe simples', body: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"/>', valid: true },
  { name: 'prólogo e comentário', body: ' \n<?xml version="1.0"?><!-- fiscal --><cteProc/>', valid: true },
  { name: 'prólogo seguido de HTML', body: '<?xml version="1.0"?><html><body>erro</body></html>', valid: false },
  { name: 'HTML direto', body: '<html>erro</html>', valid: false },
  { name: 'script direto', body: '<script>alert(1)</script>', valid: false },
  { name: 'script embutido', body: '<NFe><script>alert(1)</script></NFe>', valid: false },
  { name: 'instrução de processamento inesperada', body: '<?danger execute?><NFe/>', valid: false },
  { name: 'DOCTYPE/entidade externa', body: '<?xml version="1.0"?><!DOCTYPE NFe SYSTEM "file:///etc/passwd"><NFe/>', valid: false },
] as const;

describe('validateFiscalBlob', () => {
  it('aceita PDF com assinatura válida', async () => {
    await expect(
      validateFiscalBlob(new Blob(['%PDF-1.7\nconteudo'], { type: 'application/pdf' }), 'pdf'),
    ).resolves.toBeUndefined();
  });

  it.each(xmlFixtures)('mantém cliente e contrato Edge consistentes para $name', async ({ body, valid }) => {
    const bytes = new TextEncoder().encode(body);
    expect(isFiscalFileHeaderValid(bytes, 'xml')).toBe(valid);
    const assertion = expect(validateFiscalBlob(new Blob([body], { type: 'application/xml' }), 'xml'));
    if (valid) await assertion.resolves.toBeUndefined();
    else await assertion.rejects.toThrow('XML válido');
  });

  it('rejeita página HTML retornada como PDF', async () => {
    await expect(
      validateFiscalBlob(new Blob(['<!doctype html><html>erro</html>'], { type: 'application/pdf' }), 'pdf'),
    ).rejects.toThrow('PDF válido');
  });

  it('aplica o mesmo contrato ao XML de cancelamento', async () => {
    const body = '<?xml version="1.0"?><procEventoNFe/>';
    expect(isFiscalFileHeaderValid(new TextEncoder().encode(body), 'cancel_xml')).toBe(true);
    await expect(validateFiscalBlob(new Blob([body]), 'cancel_xml')).resolves.toBeUndefined();
  });
});
