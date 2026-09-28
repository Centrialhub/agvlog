import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareLocalStaging, verifyLocalStaging } from './prepare-local-staging.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agvlog-baseline-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}agvlog-baseline-test-`));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'repo');
  const privateDirectory = join(directory, 'private');
  for (const path of ['infra/local-staging', 'docs/qa', 'supabase/migrations']) mkdirSync(join(root, path), { recursive: true });
  mkdirSync(privateDirectory);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: '2.116.0' } }));
  writeFileSync(join(root, 'infra/local-staging/config.toml'), readFileSync(join(repo, 'infra/local-staging/config.toml')));
  const candidate = JSON.parse(readFileSync(join(repo, 'docs/qa/baseline-candidate-manifest.json'), 'utf8'));
  for (const forward of candidate.forwards) {
    const bytes = Buffer.from(`-- Synthetic unit-test forward ${forward.filename}\nSELECT 1;\n`);
    forward.sha256 = digest(bytes);
    writeFileSync(join(root, 'supabase/migrations', forward.filename), bytes);
  }
  const candidateBytes = `${JSON.stringify(candidate, null, 2)}\n`;
  writeFileSync(join(root, 'docs/qa/baseline-candidate-manifest.json'), candidateBytes);
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const ledger = { count: 896, maxVersion: '20260924155758', catalogMd5: 'a'.repeat(32) };
  const approval = {
    formatVersion: 1, purpose: 'agvlog-local-staging-reviewed-baseline', targetProjectId: 'agvlog-local-staging',
    source: { projectRef: candidate.liveObservation.projectRef, capturedAtUtc: timestamp, postgresMajor: 17,
      captureMethod: 'pg-dump-schema-only', schemaCaptureSha256: digest('synthetic schema capture'),
      ledgerCaptureSha256: digest('synthetic ledger capture'), ledgerBefore: { ...ledger }, ledgerAfter: { ...ledger } },
    review: { decision: 'approved-for-local-preparation', reviewer: 'synthetic-test-only', evidenceId: 'synthetic-review-fixture',
      reviewedAtUtc: timestamp, schemaSanitized: true, noCustomerData: true, noProductionSecrets: true,
      externalJobsDisabled: true, managedCustomizationsReviewed: true, rolesReviewed: true,
      extensionsReviewed: true, syntheticBucketsReviewed: true, rawRolesDumpExcluded: true },
    artifacts: [], candidate: { manifestSha256: digest(candidateBytes), forwards: candidate.forwards },
  };
  for (const role of ['application-schema', 'managed-customizations', 'reviewed-roles', 'reviewed-extensions', 'synthetic-buckets']) {
    const filename = `${role}.sql`;
    const bytes = Buffer.from(`-- Synthetic ${role}; this fixture never runs SQL.\nSELECT 1;\n`);
    writeFileSync(join(privateDirectory, filename), bytes);
    approval.artifacts.push({ filename, role, bytes: bytes.length, sha256: digest(bytes) });
  }
  const manifestPath = join(privateDirectory, 'approval.json');
  const save = () => {
    const bytes = `${JSON.stringify(approval, null, 2)}\n`;
    writeFileSync(manifestPath, bytes);
    return digest(bytes);
  };
  const approvedSha256 = save();
  prepareLocalStaging({ root });
  return { root, privateDirectory, manifestPath, approvedSha256, approval, save, output: join(root, '.local-staging'), directory };
}

test('explicit reviewed transition stages exact SQL outside CLI migrations while preserving bootstrap config and runtime metadata', (t) => {
  const f = fixture(t);
  const configPath = join(f.output, 'supabase/config.toml');
  const config = readFileSync(configPath);
  const configMtime = lstatSync(configPath).mtimeMs;
  mkdirSync(join(f.output, 'supabase/.temp'));
  writeFileSync(join(f.output, 'supabase/.temp/cli-latest'), 'v2.118.0');
  mkdirSync(join(f.output, 'supabase/snippets'));
  const prepared = prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 });
  assert.equal(prepared.state, 'reviewed-baseline-prepared');
  assert.equal(prepared.applicationReady, false);
  assert.deepEqual(verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), prepared);
  assert.deepEqual(readFileSync(configPath), config);
  assert.equal(lstatSync(configPath).mtimeMs, configMtime);
  assert.deepEqual(readdirSync(join(f.output, 'supabase/snippets')), []);
  assert.equal(readFileSync(join(f.output, 'supabase/.temp/cli-latest'), 'utf8'), 'v2.118.0');
  assert.equal(readdirSync(join(f.output, 'supabase')).includes('migrations'), false);
  for (const artifact of f.approval.artifacts) assert.deepEqual(readFileSync(join(f.output, 'baseline', artifact.filename)), readFileSync(join(f.privateDirectory, artifact.filename)));
  for (const forward of f.approval.candidate.forwards) assert.deepEqual(readFileSync(join(f.output, 'baseline/forwards', forward.filename)), readFileSync(join(f.root, 'supabase/migrations', forward.filename)));
  const manifest = JSON.parse(readFileSync(prepared.manifest, 'utf8'));
  assert.equal(manifest.baseline.catalogCompared, false);
  assert.equal(manifest.baseline.state, 'reviewed-artifacts-prepared-not-restored');
  assert.equal(manifest.protections.historicalReplay, 'disabled');
  assert.equal(manifest.protections.seed, 'disabled');
  assert.equal(manifest.protections.authHook, 'disabled-until-catalog-restored');
  assert.deepEqual(manifest.approvedFlows, []);
});

test('preparation is idempotent and later verification needs the external digest, not the original private directory', (t) => {
  const f = fixture(t);
  prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 });
  const paths = ['manifest.json', 'baseline/approval.json', ...f.approval.artifacts.map((item) => `baseline/${item.filename}`)];
  const before = paths.map((path) => ({ path: join(f.output, path), mtime: lstatSync(join(f.output, path)).mtimeMs }));
  prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 });
  for (const item of before) assert.equal(lstatSync(item.path).mtimeMs, item.mtime);
  rmSync(f.manifestPath);
  assert.equal(verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }).applicationReady, false);
  assert.throws(() => verifyLocalStaging({ root: f.root }), /Unknown artifact|modified/);
  assert.throws(() => verifyLocalStaging({ root: f.root, approvedSha256: 'b'.repeat(64) }), /approval_hash_mismatch/);
});

test('requires an independently supplied approval digest before any transition', (t) => {
  const f = fixture(t);
  const initial = readFileSync(join(f.output, 'manifest.json'));
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath }), /external approval hash/);
  assert.throws(() => prepareLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), /external approval hash/);
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: '0'.repeat(64) }), /approval_hash_mismatch/);
  assert.deepEqual(readFileSync(join(f.output, 'manifest.json')), initial);
  assert.equal(readdirSync(f.output).includes('baseline'), false);
});

const invalidCases = [
  ['review not completed', (a) => { a.review.noProductionSecrets = false; }, /review_incomplete/],
  ['raw production roles excluded assertion missing', (a) => { delete a.review.rawRolesDumpExcluded; }, /invalid_review_fields/],
  ['schema snapshot from another project', (a) => { a.source.projectRef = 'another-project'; }, /invalid_capture_provenance/],
  ['ledger changed during capture', (a) => { a.source.ledgerAfter.catalogMd5 = 'b'.repeat(32); }, /ledger_changed/],
  ['capture after a forward', (a) => { a.source.ledgerBefore.maxVersion = a.source.ledgerAfter.maxVersion = '20260927100000'; }, /not_after_capture/],
  ['reordered forwards', (a) => { a.candidate.forwards.reverse(); }, /forward_list_changed/],
  ['missing forward', (a) => { a.candidate.forwards.pop(); }, /candidate_manifest_changed/],
  ['missing managed customizations', (a) => { a.artifacts = a.artifacts.filter((x) => x.role !== 'managed-customizations'); }, /incomplete_or_oversized/],
  ['raw roles artifact', (a) => { a.artifacts[2].role = 'raw-roles-dump'; }, /invalid_artifact_identity/],
  ['path traversal', (a) => { a.artifacts[0].filename = '../outside.sql'; }, /invalid_artifact_identity/],
  ['duplicate artifact', (a) => { a.artifacts.push({ ...a.artifacts[0] }); }, /invalid_artifact_identity/],
  ['oversized artifact', (a) => { a.artifacts[0].bytes = 65 * 1024 * 1024; }, /invalid_artifact_identity/],
  ['unrecognized secret field', (a) => { a.password = 'synthetic-not-to-be-logged'; }, /invalid_manifest_fields/],
];
for (const [name, change, expected] of invalidCases) {
  test(`rejects ${name} even when the changed JSON hash is supplied`, (t) => {
    const f = fixture(t);
    const initial = readFileSync(join(f.output, 'manifest.json'));
    change(f.approval);
    assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.save() }), expected);
    assert.deepEqual(readFileSync(join(f.output, 'manifest.json')), initial);
    assert.equal(readdirSync(f.output).includes('baseline'), false);
  });
}

test('rejects changed private SQL or repository forward bytes before staging any artifact', (t) => {
  const f = fixture(t);
  const privatePath = join(f.privateDirectory, f.approval.artifacts[0].filename);
  const original = readFileSync(privatePath);
  writeFileSync(privatePath, Buffer.alloc(original.length, 'x'));
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 }), /baseline_artifact_changed/);
  writeFileSync(privatePath, original);
  writeFileSync(join(f.root, 'supabase/migrations', f.approval.candidate.forwards[0].filename), 'changed forward');
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 }), /candidate_forward_changed/);
  assert.equal(readdirSync(f.output).includes('baseline'), false);
});

test('rejects private input inside the checkout and linked or hard-linked source artifacts', (t) => {
  const f = fixture(t);
  const inCheckout = join(f.root, 'approval.json');
  writeFileSync(inCheckout, readFileSync(f.manifestPath));
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: inCheckout, approvedSha256: f.approvedSha256 }), /outside_checkout/);
  const linkedDirectory = join(f.directory, 'linked-private');
  symlinkSync(f.privateDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: join(linkedDirectory, 'approval.json'), approvedSha256: f.approvedSha256 }), /linked_input/);
  const artifactPath = join(f.privateDirectory, f.approval.artifacts[0].filename);
  linkSync(artifactPath, join(f.directory, 'hard-link.sql'));
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 }), /hard_linked_input/);
});

test('rejects remote links and altered prepared SQL without silently rewriting the approved stage', (t) => {
  const f = fixture(t);
  prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 });
  mkdirSync(join(f.output, 'supabase/.temp'));
  const link = join(f.output, 'supabase/.temp/project-ref');
  writeFileSync(link, 'synthetic-production-ref');
  assert.throws(() => verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), /Unknown artifact/);
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 }), /Unknown artifact/);
  rmSync(link);
  const sql = join(f.output, 'baseline', f.approval.artifacts[0].filename);
  const altered = Buffer.alloc(f.approval.artifacts[0].bytes, 'z');
  writeFileSync(sql, altered);
  assert.throws(() => verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), /baseline_artifact_changed/);
  assert.throws(() => prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 }), /modified/);
  assert.deepEqual(readFileSync(sql), altered);
});

test('does not accept a self-declared replacement approval or overwritten generated manifest', (t) => {
  const f = fixture(t);
  prepareLocalStaging({ root: f.root, baselineManifest: f.manifestPath, approvedSha256: f.approvedSha256 });
  const generatedPath = join(f.output, 'manifest.json');
  const generated = JSON.parse(readFileSync(generatedPath, 'utf8'));
  generated.applicationReady = true;
  writeFileSync(generatedPath, JSON.stringify(generated));
  assert.throws(() => verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), /modified/);
  f.approval.review.evidenceId = 'another-self-declared-review';
  writeFileSync(join(f.output, 'baseline/approval.json'), JSON.stringify(f.approval));
  assert.throws(() => verifyLocalStaging({ root: f.root, approvedSha256: f.approvedSha256 }), /approval_hash_mismatch/);
});
