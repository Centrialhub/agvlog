import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  storageSafeFileName,
  validateUploadContent,
  validateUploadFile,
} from '@/lib/uploadPolicy';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function file(name: string, type: string, size = 1) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('política de uploads privados', () => {
  it('aceita apenas os tipos previstos para cada contexto', () => {
    expect(validateUploadFile(file('foto.JPG', ''), 'image')).toBe('image/jpeg');
    expect(validateUploadFile(file('prova.pdf', 'application/pdf'), 'proof')).toBe('application/pdf');
    expect(validateUploadFile(file('nfe.xml', 'text/xml'), 'financial')).toBe('text/xml');

    expect(() => validateUploadFile(file('script.svg', 'image/svg+xml'), 'image')).toThrow();
    expect(() => validateUploadFile(file('nfe.xml', 'application/xml'), 'proof')).toThrow();
    expect(() => validateUploadFile(file('pagina.html', 'text/html'), 'financial')).toThrow();
  });

  it('rejeita arquivo vazio e acima de 10 MB', () => {
    expect(() => validateUploadFile(file('vazio.pdf', 'application/pdf', 0), 'proof')).toThrow('vazio');
    expect(() => validateUploadFile(file('grande.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1), 'proof')).toThrow('10 MB');
  });

  it('normaliza nomes usados no caminho do Storage', () => {
    expect(storageSafeFileName('../../Comprovante São João (final).PDF'))
      .toBe('Comprovante-Sao-Joao-final.PDF');
    expect(storageSafeFileName('   ')).toBe('arquivo');
  });

  it('confere assinatura real antes do upload', async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.7\nfixture')], 'proof.pdf', { type: 'application/pdf' });
    const disguised = new File([new TextEncoder().encode('<script>alert(1)</script>')], 'proof.pdf', { type: 'application/pdf' });
    const xml = new File([new TextEncoder().encode('<?xml version="1.0"?><nfe/>')], 'nfe.xml', { type: 'application/xml' });
    const xxe = new File([new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE x><nfe/>')], 'nfe.xml', { type: 'application/xml' });

    await expect(validateUploadContent(pdf, 'proof')).resolves.toBe('application/pdf');
    await expect(validateUploadContent(disguised, 'proof')).rejects.toThrow('conteúdo');
    await expect(validateUploadContent(xml, 'financial')).resolves.toBe('application/xml');
    await expect(validateUploadContent(xxe, 'financial')).rejects.toThrow('conteúdo');
  });

  it('bloqueia escrita direta nos buckets e exige scanner no gateway', () => {
    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260829144103_enforce_secure_upload_gateway_policies.sql'), 'utf8');
    const rateLimitMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20260829144001_add_production_secure_upload_rate_limits.sql'), 'utf8');
    const gateway = readFileSync(join(process.cwd(), 'supabase/functions/secure-upload/index.ts'), 'utf8');
    const secureClient = readFileSync(join(process.cwd(), 'src/lib/secureUpload.ts'), 'utf8');

    for (const policy of ['receipts_tenant_insert', 'receipts_tenant_update', 'pallet_proof_insert', 'pallet_proof_update', 'return_proof_insert', 'return_proof_update']) {
      expect(migration).toContain(`drop policy if exists ${policy}`);
    }
    expect(gateway).toContain('MALWARE_SCANNER_URL');
    expect(gateway).toContain('malware_scanner_unavailable');
    expect(gateway).toContain('file_signature_mismatch');
    expect(gateway).toContain('consume_secure_upload_quota_v1');
    expect(gateway).toContain('upload_rate_limited');
    expect(rateLimitMigration).toContain('pg_advisory_xact_lock');
    expect(rateLimitMigration).toContain('secure_upload_rate_events');
    expect(rateLimitMigration).toContain('from public, anon, authenticated');
    expect(secureClient).toContain("functions.invoke('secure-upload'");
  });
});
