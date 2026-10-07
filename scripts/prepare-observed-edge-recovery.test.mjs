import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareObservedEdgeRecovery } from './prepare-observed-edge-recovery.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const observationPath = join(repositoryRoot, 'docs/qa/edge-reconciliation-2026-09-26.json');
const snapshotRelative = 'docs/qa/edge-source-snapshots-2026-09-26';
const snapshotDir = join(repositoryRoot, snapshotRelative);
const generatorPath = join(repositoryRoot, 'scripts/prepare-observed-edge-recovery.mjs');
const slugs = ['agvlog-pipeline-run', 'ssx-sync-governance', 'ssx-sync-units'];
const observed = JSON.parse(readFileSync(observationPath, 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function listFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Unexpected symlink: ${absolute}`);
    if (entry.isDirectory()) files.push(...listFiles(root, absolute));
    else {
      assert.equal(entry.isFile(), true, `Unexpected output entry: ${absolute}`);
      files.push(relative(root, absolute).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

function makeIsolatedGenerator(t) {
  const root = mkdtempSync(join(tmpdir(), 'agvlog-observed-edge-recovery-'));
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    assert.match(basename(root), /^agvlog-observed-edge-recovery-/);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'qa'), { recursive: true });
  copyFileSync(generatorPath, join(root, 'scripts', 'prepare-observed-edge-recovery.mjs'));
  copyFileSync(observationPath, join(root, 'docs', 'qa', 'edge-reconciliation-2026-09-26.json'));
  cpSync(snapshotDir, join(root, snapshotRelative), { recursive: true });
  return root;
}

async function importIsolatedGenerator(root) {
  const modulePath = join(root, 'scripts', 'prepare-observed-edge-recovery.mjs');
  return import(pathToFileURL(modulePath).href);
}

test('reconstructs all 25 observed files with exact per-bundle identity and auth config', () => {
  const allObservedFiles = [];
  const outputs = new Map();
  for (const slug of slugs) {
    const source = observed.live_bundles.find((bundle) => bundle.slug === slug);
    assert.ok(source, `Missing observation for ${slug}`);
    const result = prepareObservedEdgeRecovery(slug);
    assert.equal(isAbsolute(result.bundleDir), true);
    assert.equal(result.entrypointPath, join(result.bundleDir, 'supabase', 'functions', slug, 'index.ts'));
    assert.equal(result.manifestPath, join(result.bundleDir, 'manifest.json'));
    assert.match(result.bundleDir.replace(/\\/g, '/'),
      new RegExp(`/\\.codex-build-audit/edge-observed-recovery-2026-09-26/${slug}$`));

    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.kind, 'local_observed_source_recovery_not_deployed');
    assert.deepEqual({
      projectRef: manifest.source.project_ref,
      slug: manifest.source.slug,
      functionId: manifest.source.function_id,
      version: manifest.source.version,
      updatedAt: manifest.source.updated_at_utc,
      bundleHash: manifest.source.bundle_ezbr_sha256,
      jwt: manifest.source.verify_jwt_live,
    }, {
      projectRef: observed.project_ref,
      slug,
      functionId: source.function_id,
      version: source.version,
      updatedAt: source.updated_at_utc,
      bundleHash: source.bundle_ezbr_sha256,
      jwt: false,
    });
    assert.equal(manifest.output.verify_jwt, false);
    assert.equal(manifest.output.config_path, 'supabase/config.toml');
    const config = readFileSync(join(result.bundleDir, manifest.output.config_path));
    assert.equal(sha256(config), manifest.output.config_sha256);
    assert.match(config.toString('utf8'), new RegExp(`\\[functions\\.${slug}\\]\\nverify_jwt = false\\n`));

    const expectedFiles = source.files.map((file) => file.path).sort();
    assert.deepEqual(manifest.output.files.map((file) => file.path).sort(), expectedFiles);
    for (const file of manifest.output.files) {
      const observedFile = source.files.find((item) => item.path === file.path);
      assert.ok(observedFile, `Unexpected source path: ${file.path}`);
      assert.equal(file.source_path, file.path);
      assert.equal(file.sha256, observedFile.sha256);
      assert.equal(file.snapshot_path, `${snapshotRelative}/${file.sha256}` + '.txt');
      const outputBytes = readFileSync(join(result.bundleDir, ...file.path.split('/')));
      const snapshotBytes = readFileSync(join(repositoryRoot, file.snapshot_path));
      assert.equal(sha256(outputBytes), observedFile.sha256);
      assert.deepEqual(outputBytes, snapshotBytes);
      allObservedFiles.push(file);
    }
    assert.deepEqual(listFiles(result.bundleDir), [
      ...expectedFiles, 'supabase/config.toml', 'manifest.json',
    ].sort());
    outputs.set(slug, result);
  }
  assert.equal(allObservedFiles.length, 25);
  assert.equal(new Set(allObservedFiles.map((file) => file.sha256)).size, 15);

  const checkpoint = 'supabase/functions/_shared/ssx-sync-checkpoint.ts';
  const utils = 'supabase/functions/_shared/ssx-utils.ts';
  const readOutput = (slug, path) => readFileSync(join(outputs.get(slug).bundleDir, ...path.split('/')));
  assert.notDeepEqual(readOutput(slugs[0], checkpoint), readOutput(slugs[1], checkpoint));
  assert.notDeepEqual(readOutput(slugs[1], utils), readOutput(slugs[2], utils));
});

test('snapshot checkout policy fixes all 15 source blobs to LF', () => {
  const hashes = [...new Set(slugs.flatMap((slug) =>
    observed.live_bundles.find((bundle) => bundle.slug === slug).files.map((file) => file.sha256)))];
  assert.equal(hashes.length, 15);
  const paths = hashes.map((hash) => `${snapshotRelative}/${hash}.txt`);
  const lines = execFileSync('git', ['check-attr', '--stdin', 'eol'], {
    cwd: repositoryRoot,
    input: `${paths.join('\n')}\n`,
    encoding: 'utf8',
  }).trim().split(/\r?\n/);
  assert.deepEqual(lines, paths.map((path) => `${path}: eol: lf`));
  for (const path of paths) {
    const bytes = readFileSync(join(repositoryRoot, ...path.split('/')));
    assert.equal(bytes.includes(Buffer.from('\r\n')), false);
    assert.equal(sha256(bytes), basename(path, '.txt'));
  }
});

test('regeneration leaves complete output byte-for-byte unchanged', () => {
  for (const slug of slugs) {
    const first = prepareObservedEdgeRecovery(slug);
    const before = new Map(listFiles(first.bundleDir).map((path) => {
      const absolute = join(first.bundleDir, ...path.split('/'));
      return [path, { hash: sha256(readFileSync(absolute)), mtimeMs: statSync(absolute).mtimeMs }];
    }));
    const second = prepareObservedEdgeRecovery(slug);
    assert.deepEqual(second, first);
    const after = new Map(listFiles(second.bundleDir).map((path) => {
      const absolute = join(second.bundleDir, ...path.split('/'));
      return [path, { hash: sha256(readFileSync(absolute)), mtimeMs: statSync(absolute).mtimeMs }];
    }));
    assert.deepEqual(after, before);
  }
});

test('rejects unsupported slugs including path traversal before touching output', () => {
  for (const slug of ['../ssx-sync-units', 'ssx-sync-units/../../escape', 'unknown']) {
    assert.throws(() => prepareObservedEdgeRecovery(slug), /Unsupported observed bundle/);
  }
});

test('an altered or missing versioned snapshot fails before writing any output', async (t) => {
  const root = makeIsolatedGenerator(t);
  const generator = await importIsolatedGenerator(root);
  const hash = observed.live_bundles.find((bundle) => bundle.slug === slugs[0]).files[0].sha256;
  const snapshotPath = join(root, snapshotRelative, `${hash}.txt`);
  const original = readFileSync(snapshotPath);
  writeFileSync(snapshotPath, Buffer.concat([original, Buffer.from('\nchanged')]));
  assert.throws(() => generator.prepareObservedEdgeRecovery(slugs[0]), /Versioned snapshot hash or encoding mismatch/);
  assert.equal(existsSync(join(root, '.codex-build-audit')), false);
  writeFileSync(snapshotPath, original);
  rmSync(snapshotPath);
  assert.throws(() => generator.prepareObservedEdgeRecovery(slugs[0]), /Versioned snapshot set changed/);
  assert.equal(existsSync(join(root, '.codex-build-audit')), false);
});

test('unknown manifest path with no hash is rejected before writing output', async (t) => {
  const root = makeIsolatedGenerator(t);
  const manifestPath = join(root, 'docs', 'qa', 'edge-reconciliation-2026-09-26.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bundle = manifest.live_bundles.find((item) => item.slug === slugs[0]);
  bundle.files[0] = { path: 'supabase/functions/_shared/unreviewed.ts' };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const generator = await importIsolatedGenerator(root);
  assert.throws(() => generator.prepareObservedEdgeRecovery(slugs[0]), /Observed bundle file list changed/);
  assert.equal(existsSync(join(root, '.codex-build-audit')), false);
});

test('refuses to overwrite an altered generated file in an isolated fixture', async (t) => {
  const root = makeIsolatedGenerator(t);
  const generator = await importIsolatedGenerator(root);
  const output = generator.prepareObservedEdgeRecovery(slugs[0]);
  writeFileSync(output.entrypointPath, 'altered fixture output\n');
  assert.throws(() => generator.prepareObservedEdgeRecovery(slugs[0]), /Recovery output differs; refusing overwrite/);
  assert.equal(readFileSync(output.entrypointPath, 'utf8'), 'altered fixture output\n');
});
