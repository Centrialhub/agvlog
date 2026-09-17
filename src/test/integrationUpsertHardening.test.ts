// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAes256HexKey } from '../../supabase/functions/_shared/aes-key';

describe('integration credential upsert hardening', () => {
  it('accepts only an exact 256-bit hexadecimal encryption key', () => {
    expect(parseAes256HexKey('a'.repeat(64))).toHaveLength(32);
    expect(parseAes256HexKey('A1'.repeat(32))).toHaveLength(32);
    for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null]) {
      expect(() => parseAes256HexKey(value)).toThrow('exactly 64 hexadecimal');
    }
  });

  it('allows preflight and POST only, without padding or truncating the configured key', () => {
    const source = readFileSync('supabase/functions/agvlog-integration-upsert/index.ts', 'utf8');
    expect(source).toContain('if (req.method !== "POST")');
    expect(source).toContain('status: 405');
    expect(source).toContain('"Allow": "POST, OPTIONS"');
    expect(source).toContain('parseAes256HexKey(encryptionKey)');
    expect(source).not.toMatch(/padEnd\(64|slice\(0, 64/);
  });
});
