import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { buildBaselineCandidateManifest, EXPECTED_FORWARD_FILES, inspectBaselineCandidate,
  runBaselineCandidateCommand } from './check-baseline-candidate.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const first = '20261006124418_route_audit.sql';
const second = '20261006131127_cargo_precision.sql';
const inventoryPath = (root) => join(root, 'docs/qa/baseline-supplement-manifest.json');
async function fixture(t, names = [first]) {
  const root = await mkdtemp(join(tmpdir(), 'agvlog-baseline-supplement-'));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    assert.match(basename(root), /^agvlog-baseline-supplement-/);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'docs/qa'), { recursive: true });
  await mkdir(join(root, 'supabase/migrations'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: '2.116.0' } }));
  for (const name of EXPECTED_FORWARD_FILES) await writeFile(join(root, 'supabase/migrations', name), 'SELECT 1;\n');
  const candidate = await buildBaselineCandidateManifest(root);
  const original = `${JSON.stringify(candidate, null, 2)}\n`;
  const oldName = '20261006013354_previous.sql', oldSql = 'SELECT 2;\n';
  const followup = `${JSON.stringify({ formatVersion: 1, purpose: 'agvlog-baseline-reviewed-followups',
    originalManifestSha256: digest(original), forwards: [{ version: oldName.slice(0, 14),
      filename: oldName, sha256: digest(oldSql) }] }, null, 2)}\n`;
  await writeFile(join(root, 'docs/qa/baseline-candidate-manifest.json'), original);
  await writeFile(join(root, 'docs/qa/baseline-followup-manifest.json'), followup);
  await writeFile(join(root, 'supabase/migrations', oldName), oldSql);
  const manifest = { formatVersion: 1, purpose: 'agvlog-baseline-reviewed-supplements',
    originalManifestSha256: digest(original), followupManifestSha256: digest(followup), forwards: [] };
  for (const name of names) {
    const bytes = `-- ${name}\nSELECT 3;\n`;
    await writeFile(join(root, 'supabase/migrations', name), bytes);
    manifest.forwards.push({ version: name.slice(0, 14), filename: name, sha256: digest(bytes) });
  }
  const save = () => writeFile(inventoryPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
  await save();
  return { root, manifest, save, original, followup };
}

test('closed supplements extend the inspected CI inventory without changing either preserved manifest/API', async (t) => {
  const { root, original, followup } = await fixture(t, [first, second]);
  const before = await readFile(inventoryPath(root));
  const { candidate, followups, supplements } = await inspectBaselineCandidate(root);
  assert.equal(candidate.forwards.length, 13);
  assert.equal(followups.forwards.length, 1);
  assert.deepEqual(supplements.forwards.map(({ filename }) => filename), [first, second]);
  assert.deepEqual(await buildBaselineCandidateManifest(root), candidate);
  assert.match(await runBaselineCandidateCommand(root, ['--write']), /13 original forwards \+ 1 reviewed follow-ups \+ 2 reviewed supplements/);
  assert.equal(await readFile(join(root, 'docs/qa/baseline-candidate-manifest.json'), 'utf8'), original);
  assert.equal(await readFile(join(root, 'docs/qa/baseline-followup-manifest.json'), 'utf8'), followup);
  assert.deepEqual(await readFile(inventoryPath(root)), before);
});

test('Windows preserved manifests are bound by normalized hashes and remain byte unchanged', async (t) => {
  const { root, original, followup } = await fixture(t);
  for (const [name, bytes] of [['baseline-candidate-manifest.json', original], ['baseline-followup-manifest.json', followup]]) {
    const windows = bytes.replace(/\n/g, '\r\n');
    await writeFile(join(root, 'docs/qa', name), windows);
    await runBaselineCandidateCommand(root, ['--write']);
    assert.equal(await readFile(join(root, 'docs/qa', name), 'utf8'), windows);
  }
});

for (const [name, mutate, expected] of [
  ['original hash', (m) => { m.originalManifestSha256 = 'f'.repeat(64); }, /preserved.*hash changed/],
  ['follow-up hash', (m) => { m.followupManifestSha256 = 'f'.repeat(64); }, /preserved.*hash changed/],
  ['unknown field', (m) => { m.autoApply = true; }, /invalid fields or scope/],
  ['empty inventory', (m) => { m.forwards = []; }, /invalid fields or scope/],
  ['omitted migration', (m) => { m.forwards.pop(); }, /extra migration inventory differs/],
  ['duplicate file', (m) => { m.forwards.push({ ...m.forwards[0] }); }, /duplicate, unordered/],
  ['duplicate version', (m) => { m.forwards[1].version = m.forwards[0].version; m.forwards[1].filename = '20261006124418_duplicate.sql'; }, /duplicate, unordered/],
  ['unordered migration', (m) => { m.forwards.reverse(); }, /duplicate, unordered/],
  ['old migration', (m) => { m.forwards[0].version = '20261006013354'; m.forwards[0].filename = '20261006013354_previous.sql'; }, /duplicate, unordered/],
  ['path escape', (m) => { m.forwards[0].filename = '../outside.sql'; }, /invalid forward identity/],
  ['version mismatch', (m) => { m.forwards[0].version = '20261006124419'; }, /invalid forward identity/],
  ['hash tamper', (m) => { m.forwards[0].sha256 = 'f'.repeat(64); }, /hash changed/],
]) test(`supplement rejects ${name} including --write`, async (t) => {
  const { root, manifest, save } = await fixture(t, [first, second]);
  mutate(manifest); await save();
  const before = await readFile(inventoryPath(root));
  await assert.rejects(runBaselineCandidateCommand(root, ['--write']), expected);
  assert.deepEqual(await readFile(inventoryPath(root)), before);
});

test('unknown or missing migration and CRLF SQL fail without blessing inputs', async (t) => {
  const { root } = await fixture(t);
  const unknown = join(root, 'supabase/migrations/20261006150000_unreviewed.sql');
  await writeFile(unknown, 'SELECT 7;\n');
  await assert.rejects(runBaselineCandidateCommand(root), /extra migration inventory differs/);
  await rm(unknown);
  const sql = join(root, 'supabase/migrations', first);
  await writeFile(sql, 'SELECT 3;\r\n');
  await assert.rejects(runBaselineCandidateCommand(root), /LF line endings/);
  await rm(sql);
  await assert.rejects(runBaselineCandidateCommand(root), /listed migration missing/);
});

test('preserved SQL or follow-up inventory cannot be hidden by a supplementary hash', async (t) => {
  const { root, manifest, save } = await fixture(t);
  const followupPath = join(root, 'docs/qa/baseline-followup-manifest.json');
  const previous = JSON.parse(await readFile(followupPath, 'utf8'));
  previous.forwards[0].sha256 = 'f'.repeat(64);
  const bytes = `${JSON.stringify(previous, null, 2)}\n`;
  await writeFile(followupPath, bytes);
  manifest.followupManifestSha256 = digest(bytes); await save();
  await assert.rejects(runBaselineCandidateCommand(root), /hash changed/);
  await writeFile(join(root, 'supabase/migrations', EXPECTED_FORWARD_FILES[0]), 'SELECT 99;\n');
  await assert.rejects(runBaselineCandidateCommand(root), /original candidate differs/);
});

test('a directory masquerading as a listed migration is rejected before reading SQL', async (t) => {
  const { root } = await fixture(t);
  const sql = join(root, 'supabase/migrations', first);
  await rm(sql); await mkdir(sql);
  await assert.rejects(runBaselineCandidateCommand(root), /must be a regular file/);
});
