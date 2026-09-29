import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareLocalStaging } from './prepare-local-staging.mjs';
import { loadPreparedLocalBaseline } from './local-staging-baseline.mjs';
import { buildLocalBaselineRestoreSql, validRestoreCounts } from './local-staging-restore-sql.mjs';
import { parseRestoreArguments, restoreLocalStagingBaseline, validateRestoreLogDirectory } from './restore-local-staging-baseline.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceSha = 'b'.repeat(40);
const counts = { publicTables: 3, publicTablesWithoutRls: 0, buckets: 0, cronJobs: 0,
  vaultSecrets: 0, httpQueue: 0, authUsers: 0, storageObjects: 0 };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agvlog-restore-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}agvlog-restore-test-`));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'repo');
  const privateDirectory = join(directory, 'private');
  const logDirectory = join(directory, 'logs');
  for (const path of ['infra/local-staging', 'docs/qa', 'supabase/migrations']) mkdirSync(join(root, path), { recursive: true });
  mkdirSync(privateDirectory, { mode: 0o700 });
  mkdirSync(logDirectory, { mode: 0o700 });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: '2.116.0' } }));
  writeFileSync(join(root, 'infra/local-staging/config.toml'), readFileSync(join(repo, 'infra/local-staging/config.toml')));
  const candidate = JSON.parse(readFileSync(join(repo, 'docs/qa/baseline-candidate-manifest.json'), 'utf8'));
  for (const forward of candidate.forwards) {
    const bytes = Buffer.from(`-- NEVER_APPLY_FORWARD ${forward.filename}\nSELECT 987654;\n`);
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
      captureMethod: 'pg-dump-schema-only', schemaCaptureSha256: digest('synthetic schema'),
      ledgerCaptureSha256: digest('synthetic ledger'), ledgerBefore: { ...ledger }, ledgerAfter: { ...ledger } },
    review: { decision: 'approved-for-local-preparation', reviewer: 'synthetic-test-only', evidenceId: 'synthetic-review-fixture',
      reviewedAtUtc: timestamp, schemaSanitized: true, noCustomerData: true, noProductionSecrets: true,
      externalJobsDisabled: true, managedCustomizationsReviewed: true, rolesReviewed: true,
      extensionsReviewed: true, syntheticBucketsReviewed: true, rawRolesDumpExcluded: true },
    artifacts: [], candidate: { manifestSha256: digest(candidateBytes), forwards: candidate.forwards },
  };
  // Deliberately not alphabetical: the command must retain manifest order.
  for (const role of ['reviewed-roles', 'application-schema', 'managed-customizations']) {
    const filename = `${role}.sql`;
    const bytes = Buffer.from(`-- TEST_ARTIFACT_${role}\nSELECT 1;\n`);
    writeFileSync(join(privateDirectory, filename), bytes);
    approval.artifacts.push({ filename, role, bytes: bytes.length, sha256: digest(bytes) });
  }
  const manifestPath = join(privateDirectory, 'approval.json');
  const manifest = `${JSON.stringify(approval, null, 2)}\n`;
  writeFileSync(manifestPath, manifest);
  const approvedSha256 = digest(manifest);
  prepareLocalStaging({ root });
  prepareLocalStaging({ root, baselineManifest: manifestPath, approvedSha256 });
  const options = { root, approvedSha256, expectedSourceSha: sourceSha, logDirectory, expectedPublicTables: 3, expectedBuckets: 0 };
  const health = { project: 'agvlog-local-staging', state: 'reviewed-baseline-preparation-verified',
    baselineApprovalSha256: approvedSha256, publicTableCount: 0, sourceSha, workingTreeClean: true, applicationReady: false,
    network: { exclusive: true, defaultBinding: '127.0.0.1' } };
  const calls = [];
  const run = (command, args, config) => {
    calls.push({ command, args, config });
    if (command === '/usr/bin/git') return args[0] === 'rev-parse' ? sourceSha : '';
    if (command === process.execPath) return JSON.stringify(health);
    if (command === '/usr/bin/docker' && args.includes('--single-transaction')) {
      writeFileSync(config.stdio[1], 'private synthetic SQL output\n');
      return '';
    }
    if (command === '/usr/bin/docker') return JSON.stringify(counts);
    throw new Error('Unexpected test command');
  };
  return { directory, root, logDirectory, options, health, calls, run, approval };
}

const mutateCalls = (f) => f.calls.filter((call) => call.args.includes('--single-transaction'));
const invoke = (f, options = {}, run = f.run) => restoreLocalStagingBaseline({ ...f.options, ...options }, { platform: 'linux', run });

test('Linux-only command and required external identities reject before executing processes', (t) => {
  const f = fixture(t);
  for (const change of [{ approvedSha256: undefined }, { expectedSourceSha: undefined },
    { expectedPublicTables: undefined }, { expectedBuckets: undefined }, { expectedPublicTables: 0 },
    { expectedBuckets: -1 }, { expectedBuckets: '0' }, { expectedPublicTables: Number.MAX_SAFE_INTEGER + 1 }, { dbUrl: 'remote' }]) {
    assert.equal(invoke(f, change).ok, false);
  }
  assert.equal(restoreLocalStagingBaseline(f.options, { platform: 'win32', run: f.run }).code, 'linux_required');
  assert.equal(f.calls.length, 0);
});

test('strict CLI parser refuses remote switches, duplicates, absent values and numeric tricks', () => {
  for (const args of [['--db-url', 'remote'], ['--check', '--check'], ['--approved-sha256'],
    ['--expected-buckets', '-1'], ['--expected-buckets', '1e2'], ['--expected-buckets', '01'],
    ['--expected-public-tables', '3.0']]) assert.throws(() => parseRestoreArguments(args));
  assert.deepEqual(parseRestoreArguments(['--check', '--expected-public-tables', '3', '--expected-buckets', '0']),
    { check: true, expectedPublicTables: 3, expectedBuckets: 0 });
});

test('readonly preflight validates prepared files and writes neither SQL nor log files', (t) => {
  const f = fixture(t);
  const manifest = join(f.root, '.local-staging/manifest.json');
  const before = { bytes: readFileSync(manifest), mtime: lstatSync(manifest).mtimeMs };
  const result = invoke(f, { check: true });
  assert.equal(result.ok, true);
  assert.equal(result.sqlExecuted, false);
  assert.equal(result.applicationReady, false);
  assert.equal(result.forwardsApplied, 0);
  assert.equal(mutateCalls(f).length, 0);
  assert.deepEqual(readdirSync(f.logDirectory), []);
  assert.deepEqual(readFileSync(manifest), before.bytes);
  assert.equal(lstatSync(manifest).mtimeMs, before.mtime);
});

test('nonempty database and failing runtime health prevent restore and private logs', (t) => {
  const f = fixture(t);
  f.health.publicTableCount = 327;
  assert.equal(invoke(f).code, 'empty_runtime_preflight_failed');
  const result = invoke(f, {}, (command, args, config) => {
    if (command === process.execPath) throw new Error('SQL PASSWORD=super-secret');
    return f.run(command, args, config);
  });
  assert.equal(result.code, 'empty_runtime_preflight_failed');
  assert.ok(!JSON.stringify(result).includes('super-secret'));
  assert.equal(mutateCalls(f).length, 0);
  assert.deepEqual(readdirSync(f.logDirectory), []);
});

test('dirty, changed and stale runtime checkout identities fail before mutation', (t) => {
  const f = fixture(t);
  for (const change of ['dirty', 'sha']) {
    const result = invoke(f, {}, (command, args, config) => command === '/usr/bin/git'
      ? (args[0] === 'rev-parse' ? (change === 'sha' ? 'c'.repeat(40) : sourceSha) : ' M file')
      : f.run(command, args, config));
    assert.equal(result.code, 'checkout_changed');
  }
  f.health.sourceSha = 'c'.repeat(40);
  assert.equal(invoke(f).code, 'empty_runtime_preflight_failed');
  assert.equal(mutateCalls(f).length, 0);
});

test('rechecks checkout and complete prepared tree after runtime preflight', (t) => {
  const f = fixture(t);
  const result = invoke(f, {}, (command, args, config) => {
    if (command === process.execPath) writeFileSync(join(f.root, '.local-staging/supabase/project-ref'), 'remote');
    return f.run(command, args, config);
  });
  assert.equal(result.stage, 'prepared_files_after_preflight');
  assert.equal(result.ok, false);
  assert.equal(mutateCalls(f).length, 0);
});

test('restores only approved artifacts in manifest order with one protected psql transaction', (t) => {
  const f = fixture(t);
  const result = invoke(f);
  assert.equal(result.ok, true);
  assert.equal(result.applicationReady, false);
  assert.equal(result.catalogCompared, false);
  assert.equal(result.forwardsApplied, 0);
  assert.equal(result.publicDataCheckedEmptyInTransaction, true);
  assert.deepEqual(result.counts, counts);
  assert.equal(mutateCalls(f).length, 1);
  const call = mutateCalls(f)[0];
  assert.equal(call.command, '/usr/bin/docker');
  assert.deepEqual(call.args, ['--host', 'unix:///var/run/docker.sock', 'exec', '-i', 'supabase_db_agvlog-local-staging',
    'psql', '-X', '--no-password', '-U', 'supabase_admin', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--file', '-']);
  assert.equal(call.config.timeout, 300_000);
  assert.equal(call.config.env.DOCKER_HOST, 'unix:///var/run/docker.sock');
  assert.deepEqual(Object.keys(call.config.env).sort(), ['DOCKER_HOST', 'HOME', 'LANG', 'PATH']);
  const sql = call.config.input.toString('utf8');
  let previous = -1;
  for (const item of f.approval.artifacts) {
    const index = sql.indexOf(`-- TEST_ARTIFACT_${item.role}`);
    assert.ok(index > previous);
    previous = index;
  }
  assert.ok(!sql.includes('NEVER_APPLY_FORWARD'));
  assert.ok(sql.indexOf('local_baseline_target_not_empty') < sql.indexOf('-- TEST_ARTIFACT'));
  assert.ok(sql.indexOf('local_baseline_inventory_mismatch') > previous);
  assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.match(sql, /local_baseline_contains_application_data/);
  assert.equal(result.restoreInputSha256, digest(call.config.input));
  assert.equal(result.privateLogSha256, digest(readFileSync(result.privateLog)));
  assert.equal(readdirSync(f.logDirectory).length, 3);
  if (process.platform === 'linux') for (const filename of readdirSync(f.logDirectory)) {
    assert.equal(lstatSync(join(f.logDirectory, filename)).mode & 0o777, 0o600);
  }
});

test('SQL failure is redacted and never claims rollback or proceeds to post-restore inventory', (t) => {
  const f = fixture(t);
  const result = invoke(f, {}, (command, args, config) => {
    if (args.includes('--single-transaction')) {
      f.calls.push({ command, args, config });
      writeFileSync(config.stdio[1], 'private: SQL includes secret-value');
      throw new Error('SQL includes secret-value');
    }
    return f.run(command, args, config);
  });
  assert.equal(result.code, 'transaction_failed_or_timed_out');
  assert.equal(result.transactionCompleted, false);
  assert.equal(result.applicationReady, false);
  assert.ok(!JSON.stringify(result).includes('secret-value'));
  assert.equal(f.calls.filter((call) => call.command === '/usr/bin/docker').length, 1);
  assert.match(readFileSync(result.privateLog, 'utf8'), /secret-value/);
});

test('invalid post-restore counts report incomplete with transaction completion explicit', (t) => {
  const f = fixture(t);
  const result = invoke(f, {}, (command, args, config) => command === '/usr/bin/docker' && !args.includes('--single-transaction')
    ? JSON.stringify({ ...counts, vaultSecrets: 1 }) : f.run(command, args, config));
  assert.equal(result.code, 'post_restore_inventory_mismatch');
  assert.equal(result.transactionCompleted, true);
  assert.equal(result.applicationReady, false);
});

test('log destinations inside checkout or through links fail before SQL', (t) => {
  const f = fixture(t);
  assert.equal(invoke(f, { logDirectory: f.root }).code, 'logs_must_be_outside_checkout');
  const alias = join(f.directory, 'logs-link');
  symlinkSync(f.logDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(invoke(f, { logDirectory: alias }).code, 'linked_or_invalid_log_directory');
  assert.equal(mutateCalls(f).length, 0);
});

test('Linux log directory permissions must be private', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  chmodSync(f.logDirectory, 0o755);
  assert.throws(() => validateRestoreLogDirectory(f.root, f.logDirectory), /log_directory_not_private/);
});

test('input builder rechecks artifact hashes and inventory validator rejects missing/extra/nonzero values', (t) => {
  const f = fixture(t);
  const baseline = loadPreparedLocalBaseline({ root: f.root, approvedSha256: f.options.approvedSha256 });
  baseline.files.set('baseline/application-schema.sql', Buffer.from('changed'));
  assert.throws(() => buildLocalBaselineRestoreSql(baseline, 3, 0), /baseline_artifact_changed/);
  assert.throws(() => buildLocalBaselineRestoreSql(baseline, '3', 0), /invalid_expected_inventory/);
  assert.equal(validRestoreCounts(counts, 3, 0), true);
  for (const invalid of [{ ...counts, buckets: 1 }, { ...counts, authUsers: 1 }, { ...counts, storageObjects: 1 },
    { ...counts, publicTablesWithoutRls: 1 }, { ...counts, extra: 1 }, { ...counts, publicTables: '3' }]) {
    assert.equal(validRestoreCounts(invalid, 3, 0), false);
  }
});
