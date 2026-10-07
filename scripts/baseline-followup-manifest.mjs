import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = 'docs/qa/baseline-followup-manifest.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireCondition = (condition, message) => { if (!condition) throw new Error(`Baseline follow-up manifest rejected: ${message}`); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

// This supplemental record never changes or extends the original manifest.
// Listing a file records a reviewed input; it does not apply SQL or approve a release.
export async function verifyBaselineFollowups({ root, candidate, forwardFiles, entries }) {
  const originals = candidate.forwards.map(({ filename }) => filename);
  const extraFiles = forwardFiles.filter((filename) => !originals.includes(filename));
  let contents;
  try { contents = await readFile(resolve(root, path), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    requireCondition(extraFiles.length === 0,
      `Expected exactly 13 candidate forwards unless every extra is explicitly listed; missing supplement for: ${extraFiles.join(', ')}`);
    return null;
  }
  let manifest;
  try { manifest = JSON.parse(contents); } catch { throw new Error('Baseline follow-up manifest rejected: invalid JSON'); }
  requireCondition(exactKeys(manifest, ['formatVersion', 'purpose', 'originalManifestSha256', 'forwards']) &&
    manifest.formatVersion === 1 && manifest.purpose === 'agvlog-baseline-reviewed-followups' &&
    typeof manifest.originalManifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.originalManifestSha256) &&
    Array.isArray(manifest.forwards), 'invalid fields or scope');
  const originalBytes = (await readFile(resolve(root, 'docs/qa/baseline-candidate-manifest.json'), 'utf8')).replace(/\r\n/g, '\n');
  requireCondition(manifest.originalManifestSha256 === digest(originalBytes), 'original manifest hash changed');
  requireCondition(originalBytes === `${JSON.stringify(candidate, null, 2)}\n`,
    'original candidate differs from repository migrations or the pinned checkpoint');
  let previousVersion = candidate.forwards.at(-1).version;
  const filenames = new Set(originals);
  for (const forward of manifest.forwards) {
    requireCondition(exactKeys(forward, ['version', 'filename', 'sha256']) &&
      typeof forward.version === 'string' && /^\d{14}$/.test(forward.version) &&
      typeof forward.filename === 'string' && /^\d{14}_[a-z0-9_]+\.sql$/.test(forward.filename) &&
      forward.filename.startsWith(`${forward.version}_`) &&
      typeof forward.sha256 === 'string' && /^[a-f0-9]{64}$/.test(forward.sha256), 'invalid forward identity');
    requireCondition(!filenames.has(forward.filename) && forward.version > previousVersion,
      'duplicate, unordered or non-follow-up migration');
    filenames.add(forward.filename);
    previousVersion = forward.version;
  }
  const listed = manifest.forwards.map(({ filename }) => filename);
  requireCondition(listed.length === extraFiles.length && listed.every((filename, index) => filename === extraFiles[index]),
    'extra migration inventory differs: missing, omitted or unknown file');
  for (const forward of manifest.forwards) {
    requireCondition(entries.find((entry) => entry.name === forward.filename)?.isFile(), 'follow-up must be a regular file');
    const bytes = await readFile(resolve(root, 'supabase/migrations', forward.filename));
    requireCondition(!bytes.includes('\r\n'), `${forward.filename} must use LF line endings`);
    requireCondition(digest(bytes) === forward.sha256, `${forward.filename} hash changed`);
  }
  return manifest;
}
