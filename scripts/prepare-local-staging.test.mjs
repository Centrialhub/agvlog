import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareLocalStaging, verifyLocalStaging } from './prepare-local-staging.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(repo, 'infra/local-staging/config.toml'), 'utf8');

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agvlog-local-staging-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}agvlog-local-staging-test-`));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'repo');
  mkdirSync(join(root, 'infra/local-staging'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: '2.116.0' } }));
  writeFileSync(join(root, 'infra/local-staging/config.toml'), template);
  return { root, directory, output: join(root, '.local-staging') };
}

function addRuntimeMetadata(output, latest = 'v2.118.0', branch = 'main') {
  for (const [relative, value] of [['supabase/.temp/cli-latest', latest], ['supabase/.branches/_current_branch', branch]]) {
    const path = join(output, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  }
}

test('prepares only isolated config and an explicitly unapproved manifest, without copying production artifacts', (t) => {
  const { root, output } = fixture(t);
  mkdirSync(join(root, 'supabase/.temp'), { recursive: true });
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  for (const file of ['.env', 'supabase/config.toml', 'supabase/seed.sql', 'supabase/.temp/project-ref', 'supabase/migrations/baseline.sql']) {
    writeFileSync(join(root, file), 'SYNTHETIC_PRODUCTION_SENTINEL');
  }
  const result = prepareLocalStaging({ root });
  assert.equal(result.workdir, output);
  assert.equal(result.applicationReady, false);
  const config = readFileSync(join(output, 'supabase/config.toml'), 'utf8');
  const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'));
  assert.equal(config, template.replace(/\r\n/g, '\n'));
  assert.equal(manifest.state, 'empty-infrastructure-only');
  assert.equal(manifest.applicationReady, false);
  assert.deepEqual(manifest.approvedFlows, []);
  assert.equal(manifest.baseline.artifact, null);
  assert.equal(manifest.files['supabase/config.toml'].sha256, createHash('sha256').update(config).digest('hex'));
  assert.doesNotMatch(config + JSON.stringify(manifest), /SYNTHETIC_PRODUCTION_SENTINEL/);
  assert.equal(existsSync(join(output, '.env')), false);
  assert.equal(existsSync(join(output, 'supabase/migrations')), false);
  assert.deepEqual(verifyLocalStaging({ root }), result);
});

test('repeated preparation preserves bytes and modification times', (t) => {
  const { root, output } = fixture(t);
  prepareLocalStaging({ root });
  const path = join(output, 'manifest.json');
  const before = { bytes: readFileSync(path), mtime: lstatSync(path).mtimeMs };
  prepareLocalStaging({ root });
  assert.deepEqual(readFileSync(path), before.bytes);
  assert.equal(lstatSync(path).mtimeMs, before.mtime);
});

test('observed CLI metadata survives preparation and verification byte-for-byte without approving application flows', (t) => {
  const { root, output } = fixture(t);
  prepareLocalStaging({ root });
  addRuntimeMetadata(output);
  const paths = ['supabase/.temp/cli-latest', 'supabase/.branches/_current_branch', 'supabase/config.toml', 'manifest.json'];
  const before = paths.map((relative) => ({ path: join(output, relative), bytes: readFileSync(join(output, relative)), mtime: lstatSync(join(output, relative)).mtimeMs }));
  assert.equal(prepareLocalStaging({ root }).applicationReady, false);
  assert.equal(verifyLocalStaging({ root }).applicationReady, false);
  for (const { path, bytes, mtime } of before) {
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(lstatSync(path).mtimeMs, mtime);
  }
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.applicationReady, false);
  assert.deepEqual(manifest.approvedFlows, []);
  assert.equal(manifest.cliVersion, '2.116.0');
  assert.equal(manifest.baseline.artifact, null);
});

test('accepts bounded future stable update notices without changing the pinned CLI', (t) => {
  const { root, output } = fixture(t);
  prepareLocalStaging({ root });
  for (const latest of ['2.119.0', 'v3.0.0', 'v99999.99999.99999']) {
    addRuntimeMetadata(output, latest);
    assert.equal(verifyLocalStaging({ root }).applicationReady, false);
    assert.equal(readFileSync(join(output, 'supabase/.temp/cli-latest'), 'utf8'), latest);
  }
});

test('rejects empty, oversized, noncanonical and nonstable update metadata without rewriting it', (t) => {
  const { root, output } = fixture(t);
  prepareLocalStaging({ root });
  for (const latest of ['', 'v2.118.0\n', 'v2.118.0\r\n', 'v02.118.0', 'v2.118.0-beta.1', '2.118.0+build', 'latest', 'v100000.0.0', 'x'.repeat(1024 * 1024), Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff])]) {
    addRuntimeMetadata(output, latest);
    assert.throws(() => prepareLocalStaging({ root }), /Invalid local CLI metadata/);
    assert.throws(() => verifyLocalStaging({ root }), /Invalid local CLI metadata/);
    assert.deepEqual(readFileSync(join(output, 'supabase/.temp/cli-latest')), Buffer.from(latest));
  }
});

test('accepts only the exact local main branch marker', (t) => {
  const { root, output } = fixture(t);
  prepareLocalStaging({ root });
  for (const branch of ['', 'main\n', 'main\r\n', 'MAIN', 'prod', 'feature', Buffer.from([0xff, 0xff, 0xff, 0xff])]) {
    addRuntimeMetadata(output, 'v2.118.0', branch);
    assert.throws(() => verifyLocalStaging({ root }), /Invalid local CLI metadata/);
    assert.deepEqual(readFileSync(join(output, 'supabase/.branches/_current_branch')), Buffer.from(branch));
  }
});

for (const artifact of ['supabase/.temp/project-ref', 'supabase/.temp/postgres-version', 'supabase/.branches/feature', 'supabase/.temp/.env', 'supabase/.branches/baseline.sql']) {
  test(`legitimate metadata does not admit ${artifact}`, (t) => {
    const { root, output } = fixture(t);
    prepareLocalStaging({ root });
    addRuntimeMetadata(output);
    writeFileSync(join(output, artifact), 'synthetic-content-not-to-be-printed');
    assert.throws(() => verifyLocalStaging({ root }), (error) => {
      assert.match(error.message, /Unknown artifact/);
      assert.doesNotMatch(error.message, /synthetic-content/);
      return true;
    });
    assert.throws(() => prepareLocalStaging({ root }), /Unknown artifact/);
    assert.equal(readFileSync(join(output, artifact), 'utf8'), 'synthetic-content-not-to-be-printed');
  });
}

for (const relative of ['supabase/.temp/cli-latest', 'supabase/.branches/_current_branch']) {
  test(`refuses a directory, junction and hard link at metadata path ${relative}`, (t) => {
    const { root, output, directory } = fixture(t);
    prepareLocalStaging({ root });
    const path = join(output, relative);
    mkdirSync(path, { recursive: true });
    assert.throws(() => verifyLocalStaging({ root }), /regular, unlinked local CLI metadata file/);
    rmdirSync(path);
    const outside = join(directory, 'metadata-source');
    mkdirSync(outside);
    symlinkSync(outside, path, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => verifyLocalStaging({ root }), /symlinks or junctions/);
    rmSync(path);
    const source = join(outside, 'original');
    const original = relative.endsWith('cli-latest') ? 'v2.118.0' : 'main';
    writeFileSync(source, original);
    linkSync(source, path);
    assert.throws(() => verifyLocalStaging({ root }), /hard-linked files/);
    assert.equal(readFileSync(source, 'utf8'), original);
  });
}

test('a modified config blocks all writes and is preserved', (t) => {
  const { root, output } = fixture(t);
  mkdirSync(join(output, 'supabase'), { recursive: true });
  const path = join(output, 'supabase/config.toml');
  writeFileSync(path, 'changed-by-another-work');
  assert.throws(() => prepareLocalStaging({ root }), /modified/);
  assert.equal(readFileSync(path, 'utf8'), 'changed-by-another-work');
  assert.equal(existsSync(join(output, 'manifest.json')), false);
});

for (const artifact of ['.env', 'supabase/.temp/project-ref', 'supabase/migrations/fake-baseline.sql', 'baseline-approved.json']) {
  test(`refuses contamination by ${artifact}`, (t) => {
    const { root, output } = fixture(t);
    const path = join(output, artifact);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'synthetic-secret-not-to-be-printed');
    assert.throws(() => prepareLocalStaging({ root }), (error) => {
      assert.match(error.message, /Unknown artifact/);
      assert.doesNotMatch(error.message, /synthetic-secret/);
      return true;
    });
    assert.equal(existsSync(join(output, 'manifest.json')), false);
    assert.equal(readFileSync(path, 'utf8'), 'synthetic-secret-not-to-be-printed');
  });
}

test('refuses a junction or symlink as output without writing outside the repository', (t) => {
  const { root, output, directory } = fixture(t);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, output, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareLocalStaging({ root }), /symlinks or junctions/);
  assert.equal(existsSync(join(outside, 'manifest.json')), false);
});

test('refuses a symlink in an existing output ancestor', (t) => {
  const { root, output, directory } = fixture(t);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  mkdirSync(output);
  symlinkSync(outside, join(output, 'supabase'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareLocalStaging({ root }), /symlinks or junctions/);
  assert.equal(existsSync(join(outside, 'config.toml')), false);
});

test('rejects changed template and CLI version before creating a workdir', (t) => {
  const { root, output } = fixture(t);
  writeFileSync(join(root, 'infra/local-staging/config.toml'), `${template}\n[remotes.production]\n`);
  assert.throws(() => prepareLocalStaging({ root }), /reviewed hash/);
  assert.equal(existsSync(output), false);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: 'latest' } }));
  assert.throws(() => prepareLocalStaging({ root }), /pinned Supabase CLI/);
  assert.equal(existsSync(output), false);
});

test('verification is read-only and rejects missing preparation or a forged approved manifest', (t) => {
  const { root, output } = fixture(t);
  assert.throws(() => verifyLocalStaging({ root }), /incomplete/);
  assert.equal(existsSync(output), false);
  prepareLocalStaging({ root });
  const path = join(output, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.applicationReady = true;
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyLocalStaging({ root }), /modified/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).applicationReady, true);
});

test('CLI rejects destination and baseline overrides before preparing anything', () => {
  for (const args of [['--output', '../production'], ['--baseline', 'invented.sql'], ['--check', '--force']]) {
    const result = spawnSync(process.execPath, [join(repo, 'scripts/prepare-local-staging.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Only --check is accepted/);
  }
});
