import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const location = 'docs/qa/baseline-supplement-manifest.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Baseline supplement rejected: ${message}`);
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// A separate closed inventory binds both preserved manifests. It records candidate
// inputs; it never rewrites an earlier manifest, executes SQL or approves deployment.
export async function verifyBaselineSupplements({ root, forwardFiles, entries }) {
  let contents;
  try { contents = await readFile(resolve(root, location), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let manifest;
  try { manifest = JSON.parse(contents); }
  catch { throw new Error('Baseline supplement rejected: invalid JSON'); }
  requireCondition(exactKeys(manifest, ['formatVersion', 'purpose', 'originalManifestSha256',
    'followupManifestSha256', 'forwards']) && manifest.formatVersion === 1 &&
    manifest.purpose === 'agvlog-baseline-reviewed-supplements' &&
    typeof manifest.originalManifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.originalManifestSha256) &&
    typeof manifest.followupManifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.followupManifestSha256) &&
    Array.isArray(manifest.forwards) && manifest.forwards.length > 0, 'invalid fields or scope');
  const preserved = [];
  for (const [file, key] of [['baseline-candidate-manifest.json', 'originalManifestSha256'],
    ['baseline-followup-manifest.json', 'followupManifestSha256']]) {
    const bytes = (await readFile(resolve(root, 'docs/qa', file), 'utf8')).replace(/\r\n/g, '\n');
    requireCondition(manifest[key] === digest(bytes), `preserved ${file} hash changed`);
    const previous = JSON.parse(bytes);
    requireCondition(Array.isArray(previous.forwards) && previous.forwards.length > 0,
      `preserved ${file} has no forward inventory`);
    preserved.push(...previous.forwards);
  }
  // Existing verifiers still validate the complete original and follow-up contracts.
  let previousVersion = preserved.at(-1).version;
  const filenames = new Set(preserved.map(({ filename }) => filename));
  for (const forward of manifest.forwards) {
    requireCondition(exactKeys(forward, ['version', 'filename', 'sha256']) &&
      typeof forward.version === 'string' && /^\d{14}$/.test(forward.version) &&
      typeof forward.filename === 'string' && /^\d{14}_[a-z0-9_]+\.sql$/.test(forward.filename) &&
      forward.filename.startsWith(`${forward.version}_`) &&
      typeof forward.sha256 === 'string' && /^[a-f0-9]{64}$/.test(forward.sha256),
    'invalid forward identity');
    requireCondition(!filenames.has(forward.filename) && forward.version > previousVersion,
      'duplicate, unordered or non-supplement migration');
    filenames.add(forward.filename);
    previousVersion = forward.version;
    requireCondition(forwardFiles.includes(forward.filename), 'listed migration missing from inventory');
    requireCondition(entries.find((entry) => entry.name === forward.filename)?.isFile(),
      'supplement must be a regular file');
    const bytes = await readFile(resolve(root, 'supabase/migrations', forward.filename));
    requireCondition(!bytes.includes('\r\n'), `${forward.filename} must use LF line endings`);
    requireCondition(digest(bytes) === forward.sha256, `${forward.filename} hash changed`);
  }
  return manifest;
}
