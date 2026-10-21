// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import forge from 'node-forge';

const require = createRequire(import.meta.url);
const braces = require('braces') as {
  (pattern: string, options?: Record<string, unknown>): string[];
  expand(pattern: string): string[];
  parse(pattern: string): unknown;
};
const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
const md = forge.md.sha256.create();
md.update('Synthetic DigestAlgorithm validation; no real certificate');
const digest = md.digest().getBytes();
const a = forge.asn1;
function signInfo(parameters: string | undefined, extra = false, indefinite = false) {
  const algorithm = [a.create(a.Class.UNIVERSAL, a.Type.OID, false,
    a.oidToDer('2.16.840.1.101.3.4.2.1').getBytes())];
  if (parameters !== undefined) algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.NULL, false, parameters));
  if (extra) algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'unconsumed'));
  const info = a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
    a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, algorithm),
    a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, digest),
  ]);
  let encoded = a.toDer(info).getBytes();
  if (indefinite) encoded = '\x30\x80' + encoded.slice(2) + '\x00\x00';
  return keys.privateKey.sign(encoded, 'NONE');
}

describe('actual RSA DigestInfo validation', () => {
  it('rejects nested unconsumed children (synthetic private-key structural regression)', () => {
    expect(() => keys.publicKey.verify(digest, signInfo('', true))).toThrow('DigestInfo');
  });
  it.each([1, 8, 32])('rejects NULL parameters with %i bytes', length => {
    expect(() => keys.publicKey.verify(digest, signInfo('x'.repeat(length)))).toThrow('DigestInfo');
  });
  it.each([undefined, ''])('preserves valid absent/empty parameters: %s', parameters => {
    expect(keys.publicKey.verify(digest, signInfo(parameters))).toBe(true);
  });
  it('preserves BER indefinite outer sequence and rejects a wrong digest', () => {
    expect(keys.publicKey.verify(digest, signInfo('', false, true))).toBe(true);
    expect(keys.publicKey.verify('\x00'.repeat(32), signInfo(''))).toBe(false);
  });
  it('preserves PSS and NONE verification', () => {
    const pss = forge.pss.create({ md: forge.md.sha256.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 20 });
    const signed = keys.privateKey.sign(md, pss);
    expect(keys.publicKey.verify(digest, signed, pss)).toBe(true);
    expect(keys.publicKey.verify(digest, keys.privateKey.sign(digest, 'NONE'), 'NONE')).toBe(true);
  });
});

describe('bounded pattern parser', () => {
  it.each(['{', '('])('rejects 4000 nested %s within the upstream length limit', opener => {
    const closer = opener === '{' ? '}' : ')';
    expect(() => braces(opener.repeat(4000) + 'x' + closer.repeat(4000)))
      .toThrow('Maximum pattern nesting depth (128) exceeded');
  });
  it('preserves brace alternatives, ranges, escapes, quotes and normal nesting', () => {
    expect(braces.expand('src/{a,b}.{ts,tsx}')).toEqual(['src/a.ts', 'src/a.tsx', 'src/b.ts', 'src/b.tsx']);
    expect(braces.expand('file{1..3}')).toEqual(['file1', 'file2', 'file3']);
    expect(braces.expand('file\\{a,b\\}')).toEqual(['file{a,b}']);
    expect(braces.expand('"{a,b}"')).toEqual(['{a,b}']);
    const nested = '{'.repeat(32) + 'a,b' + '}'.repeat(32);
    expect(braces(nested)[0]).toContain('a|b');
    expect(() => braces.parse('('.repeat(32) + 'x' + ')'.repeat(32))).not.toThrow();
  });
  it('cannot opt out of the security limit and ignores escaped/quoted braces', () => {
    expect(() => braces('{'.repeat(4000) + 'x', { maxDepth: Infinity }))
      .toThrow('Maximum pattern nesting depth (128) exceeded');
    expect(() => braces('"' + '{'.repeat(4000) + '"')).not.toThrow();
    expect(() => braces('\\{'.repeat(4000))).not.toThrow();
  });
});
