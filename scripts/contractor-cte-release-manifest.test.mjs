import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { inspectBaselineCandidate } from './check-baseline-candidate.mjs';
import { contractorCteMigration, verifyContractorCteRelease } from './contractor-cte-release-manifest.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('release addition preserves the closed baseline and binds only the separately applied CT-e migration', async () => {
  const inspected = await inspectBaselineCandidate();
  assert.equal(inspected.candidate.forwards.length + inspected.followups.forwards.length + inspected.supplements.forwards.length, 46);
  assert.equal(inspected.releaseAddition.filename, contractorCteMigration);
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agvlog-contractor-manifest-'));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir()); assert.match(basename(root), /^agvlog-contractor-manifest-/);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'docs/qa'), { recursive: true });
  await mkdir(join(root, 'supabase/migrations'), { recursive: true });
  const preserved = 'preserved fixture\n', sql = 'begin;\nselect 1;\ncommit;\n';
  await writeFile(join(root, 'docs/qa/baseline-supplement-manifest.json'), preserved);
  await writeFile(join(root, 'supabase/migrations', contractorCteMigration), sql);
  const manifest = { formatVersion: 1, purpose: 'agvlog-contractor-cte-import-only', filename: contractorCteMigration,
    sha256: digest(sql), preservedSupplementSha256: digest(preserved) };
  const save = () => writeFile(join(root, 'docs/qa/contractor-cte-release-manifest.json'), JSON.stringify(manifest));
  await save();
  const verify = async () => verifyContractorCteRelease({ root, forwardFiles: [contractorCteMigration], entries: await readdir(join(root, 'supabase/migrations'), { withFileTypes: true }) });
  return { root, manifest, save, verify };
}
test('changed migration bytes and changed preserved manifests are refused', async t => {
  const f = await fixture(t); await f.verify();
  const sqlPath = join(f.root, 'supabase/migrations', contractorCteMigration), sql = await readFile(sqlPath);
  await writeFile(sqlPath, 'select 2;\n'); await assert.rejects(f.verify(), /migration bytes changed/);
  await writeFile(sqlPath, sql);
  await writeFile(join(f.root, 'docs/qa/baseline-supplement-manifest.json'), 'changed');
  await assert.rejects(f.verify(), /preserved supplement changed/);
});
test('another filename cannot be excluded from the closed baseline inventory', async t => {
  const f = await fixture(t); f.manifest.filename = '20261104000000_unreviewed.sql'; await f.save();
  await assert.rejects(f.verify(), /closed identity required/);
});
