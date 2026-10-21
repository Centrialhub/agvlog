import { createDecipheriv, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 32 * 1024 * 1024;
const MAGIC = Buffer.from('AGVBASE1');
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

export function decodeBaseline(bytes, key, sha256) {
  if (!/^[a-f0-9]{64}$/.test(key ?? '') || !/^[a-f0-9]{64}$/.test(sha256 ?? '') ||
      bytes.length < 37 || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(MAGIC) ||
      createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Invalid encrypted baseline');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(8, 20));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(20, 36));
  const compressed = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  const archive = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_BYTES }).toString('utf8'));
  if (archive.formatVersion !== 1 || !Array.isArray(archive.files) || !archive.files.length || archive.files.length > 64) {
    throw new Error('Invalid baseline archive');
  }
  const seen = new Set();
  return archive.files.map(({ path, content }) => {
    if (typeof path !== 'string' || !/^(?:revisions\/[a-f0-9]{64}\/)?(?:approval\.json|[a-z][a-z0-9-]{0,95}\.sql)$/.test(path) ||
        seen.has(path) || typeof content !== 'string' || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      throw new Error('Invalid baseline entry');
    }
    seen.add(path);
    return { path, bytes: Buffer.from(content, 'base64') };
  });
}

export function extractBaseline({ bytes, key, sha256, temp, checkout }) {
  const parent = realpathSync(temp);
  if (inside(realpathSync(checkout), parent)) throw new Error('Private baseline must remain outside checkout');
  const files = decodeBaseline(bytes, key, sha256); // Authenticate and validate ALL entries before writing.
  const directory = mkdtempSync(join(parent, 'agvlog-reviewed-baseline-'));
  try {
    for (const file of files) {
      const destination = join(directory, file.path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, file.bytes, { flag: 'wx', mode: 0o600 });
    }
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function downloadBaseline(url) {
  if (!/^https:\/\/github\.com\/Centrialhub\/agvlog\/releases\/download\/[a-z0-9-]+\/[a-z0-9.-]+\.enc$/.test(url ?? '')) {
    throw new Error('Expected encrypted baseline release asset');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Baseline download failed');
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error('Baseline download too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.AGVLOG_CI_BASELINE_KEY || !process.env.GITHUB_OUTPUT) throw new Error('Missing private CI configuration');
    const directory = extractBaseline({ bytes: await downloadBaseline(process.env.AGVLOG_CI_BASELINE_URL),
      key: process.env.AGVLOG_CI_BASELINE_KEY, sha256: process.env.AGVLOG_CI_BASELINE_CIPHERTEXT_SHA256,
      temp: process.env.RUNNER_TEMP, checkout: process.env.GITHUB_WORKSPACE });
    appendFileSync(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
    console.log('Private baseline provisioned; restore still requires the reviewed approval chain.');
  } catch {
    console.error('Private CI baseline provisioning failed. Check the encrypted asset, digest and Actions secret; no remote database fallback.');
    process.exitCode = 1;
  }
}
