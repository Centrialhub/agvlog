import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
