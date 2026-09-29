import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  buildBaselineCandidateManifest,
  EXPECTED_FORWARD_FILES,
  runBaselineCandidateCommand,
  verifyBaselineCandidateManifest,
} from "./check-baseline-candidate.mjs";

async function makeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "agvlog-baseline-candidate-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    assert.match(basename(root), /^agvlog-baseline-candidate-/);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "supabase", "migrations"), { recursive: true });
  await mkdir(join(root, "docs", "qa"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { supabase: "2.116.0" } }));
  await Promise.all(EXPECTED_FORWARD_FILES.map((filename) =>
    writeFile(join(root, "supabase", "migrations", filename), `-- fixture ${filename}\nselect 'private-fixture-marker';\n`)));
  const manifest = await buildBaselineCandidateManifest(root);
  await writeFile(join(root, "docs", "qa", "baseline-candidate-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

test("manifest records the historical cutoff and byte hashes without SQL content", async (t) => {
  const root = await makeFixture(t);
  const manifest = await verifyBaselineCandidateManifest(root);
  assert.deepEqual({
    count: manifest.liveObservation.migrationCount,
    cutoff: manifest.liveObservation.maxVersion,
    forwards: manifest.forwards.length,
  }, { count: 896, cutoff: "20260924155758", forwards: 13 });
  const firstSql = await readFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]));
  assert.equal(manifest.forwards[0].sha256, createHash("sha256").update(firstSql).digest("hex"));
  assert.doesNotMatch(JSON.stringify(manifest), /private-fixture-marker/);
  assert.deepEqual(Object.keys(manifest.forwards[0]), ["version", "filename", "sha256"]);
});

test("a changed migration body invalidates the reviewed manifest", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]), "select 2;\n");
  await assert.rejects(verifyBaselineCandidateManifest(root), /differs from repository migrations/);
});

test("an extra future migration blocks candidate preparation", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", "20260927000000_unreviewed_change.sql"), "select 1;\n");
  await assert.rejects(buildBaselineCandidateManifest(root), /Expected exactly 13 candidate forwards/);
});

test("a changed historical ledger checkpoint is rejected", async (t) => {
  const root = await makeFixture(t);
  const path = join(root, "docs", "qa", "baseline-candidate-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.liveObservation.migrationCount = 897;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(verifyBaselineCandidateManifest(root), /differs from repository migrations/);
});

test("an unpinned Supabase CLI blocks candidate preparation", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { supabase: "^2.116.0" } }));
  await assert.rejects(buildBaselineCandidateManifest(root), /must be pinned to an exact version/);
});

test("Windows line endings cannot bless a hash that Git will normalize", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]), "select 1;\r\n");
  await assert.rejects(buildBaselineCandidateManifest(root), /must use LF line endings/);
});

test("manifest formatting remains portable on a Windows checkout", async (t) => {
  const root = await makeFixture(t);
  const path = join(root, "docs", "qa", "baseline-candidate-manifest.json");
  const saved = await readFile(path, "utf8");
  await writeFile(path, saved.replace(/\n/g, "\r\n"));
  await verifyBaselineCandidateManifest(root);
});

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originalPath = (root) => join(root, 'docs/qa/baseline-candidate-manifest.json');
const supplementPath = (root) => join(root, 'docs/qa/baseline-followup-manifest.json');
const followupName = '20260928182208_restrict_internal_trigger_execute.sql';

async function addSupplement(root, filenames = [followupName]) {
  const original = (await readFile(originalPath(root), 'utf8')).replace(/\r\n/g, '\n');
  const forwards = [];
  for (const filename of filenames) {
    const bytes = `-- reviewed follow-up fixture ${filename}\nSELECT 2;\n`;
    await writeFile(join(root, 'supabase/migrations', filename), bytes);
    forwards.push({ version: filename.slice(0, 14), filename, sha256: hash(bytes) });
  }
  const supplement = { formatVersion: 1, purpose: 'agvlog-baseline-reviewed-followups', originalManifestSha256: hash(original), forwards };
  const save = () => writeFile(supplementPath(root), `${JSON.stringify(supplement, null, 2)}\n`);
  await save();
  return { supplement, save };
}

test('explicit supplement admits reviewed extras while build/verify preserve the original 13-forward API', async (t) => {
  const root = await makeFixture(t);
  const originalBytes = await readFile(originalPath(root));
  await addSupplement(root);
  const original = JSON.parse(originalBytes);
  assert.deepEqual(await buildBaselineCandidateManifest(root), original);
  assert.deepEqual(await verifyBaselineCandidateManifest(root), original);
  assert.match(await runBaselineCandidateCommand(root), /13 original forwards \+ 1 reviewed follow-ups/);
  const supplementBytes = await readFile(supplementPath(root));
  const originalMtime = (await stat(originalPath(root))).mtimeMs;
  const supplementMtime = (await stat(supplementPath(root))).mtimeMs;
  assert.match(await runBaselineCandidateCommand(root, ['--write']), /13 original forwards \+ 1 reviewed follow-ups/);
  assert.deepEqual(await readFile(originalPath(root)), originalBytes);
  assert.deepEqual(await readFile(supplementPath(root)), supplementBytes);
  assert.equal((await stat(originalPath(root))).mtimeMs, originalMtime);
  assert.equal((await stat(supplementPath(root))).mtimeMs, supplementMtime);
});

test('supplement binds LF-normalized original JSON on Windows without rewriting its bytes', async (t) => {
  const root = await makeFixture(t);
  await addSupplement(root);
  const windowsBytes = (await readFile(originalPath(root), 'utf8')).replace(/\n/g, '\r\n');
  await writeFile(originalPath(root), windowsBytes);
  await runBaselineCandidateCommand(root, ['--write']);
  assert.equal(await readFile(originalPath(root), 'utf8'), windowsBytes);
});

test('tampering with a follow-up body fails even under --write and preserves both manifests', async (t) => {
  const root = await makeFixture(t);
  await addSupplement(root);
  const before = await Promise.all([readFile(originalPath(root)), readFile(supplementPath(root))]);
  await writeFile(join(root, 'supabase/migrations', followupName), 'SELECT 99;\n');
  await assert.rejects(runBaselineCandidateCommand(root, ['--write']), /hash changed/);
  assert.deepEqual(await Promise.all([readFile(originalPath(root)), readFile(supplementPath(root))]), before);
});

for (const [name, mutate, error] of [
  ['incorrect original hash', (m) => { m.originalManifestSha256 = 'f'.repeat(64); }, /original manifest hash changed/],
  ['omitted extra', (m) => { m.forwards = []; }, /inventory differs/],
  ['duplicate filename', (m) => { m.forwards.push({ ...m.forwards[0] }); }, /duplicate, unordered/],
  ['duplicate version', (m) => { m.forwards.push({ ...m.forwards[0], filename: '20260928182208_other.sql' }); }, /duplicate, unordered/],
  ['version and filename mismatch', (m) => { m.forwards[0].version = '20260928182209'; }, /invalid forward identity/],
  ['path escape', (m) => { m.forwards[0].filename = '../outside.sql'; }, /invalid forward identity/],
  ['unknown field', (m) => { m.autoApprove = true; }, /invalid fields or scope/],
]) {
  test(`supplement rejects ${name}`, async (t) => {
    const root = await makeFixture(t);
    const { supplement, save } = await addSupplement(root);
    mutate(supplement);
    await save();
    await assert.rejects(buildBaselineCandidateManifest(root), error);
  });
}

test('unknown future files and listed-but-missing files fail the exact supplemental inventory', async (t) => {
  const root = await makeFixture(t);
  await addSupplement(root);
  const unknown = join(root, 'supabase/migrations/20260929120000_unreviewed.sql');
  await writeFile(unknown, 'SELECT 1;\n');
  await assert.rejects(buildBaselineCandidateManifest(root), /inventory differs/);
  await rm(unknown);
  await rm(join(root, 'supabase/migrations', followupName));
  await assert.rejects(buildBaselineCandidateManifest(root), /inventory differs/);
});

for (const filename of ['20260924155757_before_cutoff.sql', '20260925120000_before_original_batch.sql']) {
  test(`supplement cannot admit ${filename}`, async (t) => {
    const root = await makeFixture(t);
    await addSupplement(root, [filename]);
    await assert.rejects(buildBaselineCandidateManifest(root), /duplicate, unordered or non-follow-up/);
  });
}

test('multiple follow-ups require chronological order and cannot reuse an original filename', async (t) => {
  const root = await makeFixture(t);
  const { supplement, save } = await addSupplement(root, [followupName, '20260929120000_second.sql']);
  assert.match(await runBaselineCandidateCommand(root), /13 original forwards \+ 2 reviewed follow-ups/);
  supplement.forwards.reverse();
  await save();
  await assert.rejects(buildBaselineCandidateManifest(root), /duplicate, unordered/);
  supplement.forwards = [JSON.parse(await readFile(originalPath(root), 'utf8')).forwards[0]];
  await save();
  await assert.rejects(buildBaselineCandidateManifest(root), /duplicate, unordered/);
});

test('--write neither approves an unknown extra nor replaces an existing original after SQL changes', async (t) => {
  const root = await makeFixture(t);
  const original = await readFile(originalPath(root));
  const unknown = join(root, 'supabase/migrations', followupName);
  await writeFile(unknown, 'SELECT 1;\n');
  await assert.rejects(runBaselineCandidateCommand(root, ['--write']), /missing supplement/);
  await assert.rejects(readFile(supplementPath(root)), { code: 'ENOENT' });
  await rm(unknown);
  await writeFile(join(root, 'supabase/migrations', EXPECTED_FORWARD_FILES[0]), 'SELECT 2;\n');
  await assert.rejects(runBaselineCandidateCommand(root, ['--write']), /cannot replace a reviewed original/);
  assert.deepEqual(await readFile(originalPath(root)), original);
});

test('supplement cannot hide a changed original migration even if its original JSON hash is updated', async (t) => {
  const root = await makeFixture(t);
  const { supplement, save } = await addSupplement(root);
  const original = JSON.parse(await readFile(originalPath(root), 'utf8'));
  original.liveObservation.migrationCount = 897;
  const bytes = `${JSON.stringify(original, null, 2)}\n`;
  await writeFile(originalPath(root), bytes);
  supplement.originalManifestSha256 = hash(bytes);
  await save();
  await assert.rejects(verifyBaselineCandidateManifest(root), /original candidate differs/);
});
