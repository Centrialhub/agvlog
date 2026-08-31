import { describe, expect, it } from 'vitest';
import forgeModule from 'node-forge';
import { parseFiscalPkcs12 } from '../../supabase/functions/_shared/fiscal-certificate';

const forge = forgeModule;

function createTestPfx(password: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attributes = [
    { name: 'commonName', value: 'LIRA TRANSPORTES:42985218002136' },
    { name: 'countryName', value: 'BR' },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
    algorithm: '3des',
    friendlyName: 'A1 teste',
  });
  const binary = forge.asn1.toDer(p12).getBytes();
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

describe('fiscal A1 certificate parser', () => {
  it('opens a password protected PFX and extracts safe metadata plus PEM material', async () => {
    const parsed = await parseFiscalPkcs12(createTestPfx('senha-segura'), 'senha-segura');
    expect(parsed.certificateCnpj).toBe('42985218002136');
    expect(parsed.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(parsed.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(parsed.thumbprint).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.validTo.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not expose a PFX protected by another password', async () => {
    await expect(parseFiscalPkcs12(createTestPfx('senha-correta'), 'senha-errada'))
      .rejects.toThrow('Confira a senha');
  });
});
