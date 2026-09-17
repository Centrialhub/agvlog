export function parseAes256HexKey(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('AES-256 key must contain exactly 64 hexadecimal characters');
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
