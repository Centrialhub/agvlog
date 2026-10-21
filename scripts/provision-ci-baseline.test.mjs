import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBaseline, extractBaseline, downloadBaseline } from './provision-ci-baseline.mjs';

function fixture(files = [{ path: 'approval.json', content: Buffer.from('{"reviewed":true}').toString('base64') }]) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const magic = Buffer.from('AGVBASE1');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify({ formatVersion: 1, files }))), cipher.final()]);
  const bytes = Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]);
  return { bytes, key: key.toString('hex'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
test('authenticated archive preserves exact approved bytes outside checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'baseline-test-'));
  const checkout = join(root, 'checkout'); mkdirSync(checkout);
  try {
    const directory = extractBaseline({ ...fixture(), temp: root, checkout });
    assert.equal(readFileSync(join(directory, 'approval.json'), 'utf8'), '{"reviewed":true}');
    assert.deepEqual(readdirSync(checkout), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('rejects wrong or missing secret and altered ciphertext or digest', () => {
  const f = fixture();
  for (const key of [undefined, '', '0'.repeat(64)]) assert.throws(() => decodeBaseline(f.bytes, key, f.sha256));
  assert.throws(() => decodeBaseline(f.bytes, f.key, '0'.repeat(64)));
  f.bytes[f.bytes.length - 1] ^= 1;
  assert.throws(() => decodeBaseline(f.bytes, f.key, createHash('sha256').update(f.bytes).digest('hex')));
});
test('rejects traversal, absolute paths, unexpected files, duplicate entries and malformed base64', () => {
  for (const path of ['../approval.json', '/approval.json', 'C:\\approval.json', 'revisions/../approval.json', 'secrets.env']) {
    const f = fixture([{ path, content: 'eA==' }]); assert.throws(() => decodeBaseline(f.bytes, f.key, f.sha256));
  }
  for (const files of [[{ path: 'approval.json', content: '???' }], Array(2).fill({ path: 'approval.json', content: 'eA==' }), []]) {
    const f = fixture(files); assert.throws(() => decodeBaseline(f.bytes, f.key, f.sha256));
  }
});
test('rejects extraction inside checkout before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'baseline-test-'));
  try {
    assert.throws(() => extractBaseline({ ...fixture(), temp: root, checkout: root }));
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('rejects untrusted URLs without issuing requests', async () => {
  for (const url of ['http://github.com/Centrialhub/agvlog/releases/download/v1/a.enc', 'https://example.com/base.enc', undefined]) {
    await assert.rejects(downloadBaseline(url));
  }
});
test('rejects a compressed archive exceeding the decompression budget', () => {
  const f = fixture([{ path: 'approval.json', content: 'A'.repeat(33 * 1024 * 1024) }]);
  assert.throws(() => decodeBaseline(f.bytes, f.key, f.sha256));
});
test('validates every entry before creating an output directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'baseline-test-'));
  const checkout = join(root, 'checkout'); mkdirSync(checkout);
  try {
    const f = fixture([{ path: 'approval.json', content: 'eA==' }, { path: '../escaped.sql', content: 'eA==' }]);
    assert.throws(() => extractBaseline({ ...f, temp: root, checkout }));
    assert.deepEqual(readdirSync(root), ['checkout']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
