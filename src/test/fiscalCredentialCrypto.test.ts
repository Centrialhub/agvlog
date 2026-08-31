// @vitest-environment node
import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptFiscalCredential, encryptFiscalCredential } from '../../supabase/functions/_shared/fiscal-credential-crypto';

const key = 'a1'.repeat(32);
const token = 'test-only-hub-token-not-a-real-credential';
function legacyEnvelope() {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return 'enc:v1:' + iv.toString('hex') + ':' + bytes.toString('hex');
}
describe('shared fiscal credential crypto', () => {
  it('reads an independently generated legacy AES-GCM record', async () => {
    expect(await decryptFiscalCredential(legacyEnvelope(), key)).toBe(token);
  });
  it('verifies newly encrypted tokens and uses a fresh nonce on every save', async () => {
    const first = await encryptFiscalCredential(token, key);
    const second = await encryptFiscalCredential(token, key);
    expect(first).not.toBe(second);
    expect(first).not.toContain(token);
    expect(await decryptFiscalCredential(first, key)).toBe(token);
    expect(await decryptFiscalCredential(second, key)).toBe(token);
  });
  it('does not pretend that a record encrypted with another key can be recovered', async () => {
    await expect(decryptFiscalCredential(legacyEnvelope(), 'b2'.repeat(32))).rejects.toThrow();
  });
  it('rejects tampering with the authentication tag', async () => {
    const envelope = legacyEnvelope();
    const tampered = envelope.slice(0, -1) + (envelope.endsWith('0') ? '1' : '0');
    await expect(decryptFiscalCredential(tampered, key)).rejects.toThrow();
  });
  it.each(['plaintext-token', 'enc:v2:001122:001122', 'enc:v1:zz:00', 'enc:v1:' + 'aa'.repeat(12) + ':abc'])('rejects malformed envelopes without including them in the error', async envelope => {
    await expect(decryptFiscalCredential(envelope, key)).rejects.toThrow('Invalid fiscal credential envelope');
  });
  it('refuses missing keys and empty tokens', async () => {
    await expect(encryptFiscalCredential(token, '')).rejects.toThrow();
    await expect(decryptFiscalCredential(legacyEnvelope(), '')).rejects.toThrow();
    await expect(encryptFiscalCredential(' ', key)).rejects.toThrow();
  });
});
