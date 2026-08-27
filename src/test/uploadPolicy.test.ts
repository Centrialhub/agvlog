import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  storageSafeFileName,
  validateUpload,
} from '@/lib/uploadPolicy';

function makeFile(name: string, type: string, size = 1024): File {
  const f = new File([new Uint8Array(Math.min(size, 1))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateUpload', () => {
  it('aceita imagens permitidas para kind image', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(validateUpload(makeFile('a.bin', t), 'image').contentType).toBe(t);
    }
  });

  it('recusa pdf em kind image e aceita em proof', () => {
    expect(() => validateUpload(makeFile('a.pdf', 'application/pdf'), 'image')).toThrow();
    expect(validateUpload(makeFile('a.pdf', 'application/pdf'), 'proof').contentType).toBe(
      'application/pdf',
    );
  });

  it('aceita xml apenas em financial', () => {
    expect(validateUpload(makeFile('nf.xml', 'application/xml'), 'financial').contentType).toBe(
      'application/xml',
    );
    expect(validateUpload(makeFile('nf.xml', 'text/xml'), 'financial').contentType).toBe('text/xml');
    expect(() => validateUpload(makeFile('nf.xml', 'text/xml'), 'proof')).toThrow();
  });

  it('recusa tipos fora da allowlist', () => {
    expect(() => validateUpload(makeFile('a.exe', 'application/x-msdownload'), 'financial')).toThrow(
      /não permitido/i,
    );
  });

  it('infere tipo pela extensão quando file.type está vazio', () => {
    expect(validateUpload(makeFile('foto.JPG', ''), 'image').contentType).toBe('image/jpeg');
    expect(validateUpload(makeFile('doc.pdf', ''), 'proof').contentType).toBe('application/pdf');
    expect(validateUpload(makeFile('nf.xml', ''), 'financial').contentType).toBe('application/xml');
    expect(() => validateUpload(makeFile('sem-extensao', ''), 'image')).toThrow();
  });

  it('recusa arquivo vazio', () => {
    expect(() => validateUpload(makeFile('a.png', 'image/png', 0), 'image')).toThrow(/vazio/i);
  });

  it('recusa arquivo maior que 10 MB', () => {
    expect(() =>
      validateUpload(makeFile('a.png', 'image/png', MAX_UPLOAD_BYTES + 1), 'image'),
    ).toThrow(/10 MB/);
  });
});

describe('storageSafeFileName', () => {
  it('normaliza nome com acentos, espaços e traversal', () => {
    const out = storageSafeFileName('../../Comprovante São João (final).PDF');
    expect(out).not.toContain('..');
    expect(out).not.toContain('/');
    expect(out).toMatch(/Comprovante_Sao_Joao/);
    expect(out.endsWith('.PDF')).toBe(true);
  });

  it('limita a 120 caracteres e usa fallback', () => {
    expect(storageSafeFileName('a'.repeat(300)).length).toBe(120);
    expect(storageSafeFileName('///')).toBe('arquivo');
    expect(storageSafeFileName('')).toBe('arquivo');
  });
});
