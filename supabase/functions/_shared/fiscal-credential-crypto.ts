// enc:v1 remains compatible with existing records. Do not rotate the shared
// project key to repair one emitter: other integrations depend on that key.
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
async function importLegacyKey(keyHex: string, usage: KeyUsage): Promise<CryptoKey> {
  if (!keyHex) throw new Error('Fiscal encryption key is missing');
  // Preserve the exact v1 derivation for historical credentials.
  return crypto.subtle.importKey('raw', hexToBytes(keyHex.padEnd(64, '0').slice(0, 64)), { name: 'AES-GCM' }, false, [usage]);
}
export async function decryptFiscalCredential(encrypted: string, keyHex: string): Promise<string> {
  const match = /^enc:v1:([a-fA-F0-9]{24}):((?:[a-fA-F0-9]{2}){17,})$/.exec(encrypted);
  if (!match) throw new Error('Invalid fiscal credential envelope');
  const key = await importLegacyKey(keyHex, 'decrypt');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(match[1]) }, key, hexToBytes(match[2]));
  const token = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  if (!token.trim()) throw new Error('Empty fiscal credential');
  return token;
}
export async function encryptFiscalCredential(token: string, keyHex: string): Promise<string> {
  if (!token.trim()) throw new Error('Empty fiscal credential');
  const key = await importLegacyKey(keyHex, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const envelope = 'enc:v1:' + bytesToHex(iv) + ':' + bytesToHex(new Uint8Array(ciphertext));
  // Use the exact reader used by both emission and polling before saving.
  if (await decryptFiscalCredential(envelope, keyHex) !== token) throw new Error('Fiscal credential verification failed');
  return envelope;
}
