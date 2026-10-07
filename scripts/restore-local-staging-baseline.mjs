import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLocalStaging } from './prepare-local-staging.mjs';
import { loadPreparedLocalBaseline } from './local-staging-baseline.mjs';
import { buildLocalBaselineRestoreSql, restoreInventorySql, validRestoreCounts } from './local-staging-restore-sql.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const project = 'agvlog-local-staging';
const container = `supabase_db_${project}`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const localEnvironment = {
  PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
  HOME: process.env.HOME, LANG: 'C.UTF-8', DOCKER_HOST: 'unix:///var/run/docker.sock',
};

class RestoreFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const ensure = (condition, code) => { if (!condition) throw new RestoreFailure(code); };

export function parseRestoreArguments(args) {
  const flags = { '--approved-sha256': 'approvedSha256', '--expected-source-sha': 'expectedSourceSha',
    '--log-directory': 'logDirectory', '--expected-public-tables': 'expectedPublicTables', '--expected-buckets': 'expectedBuckets' };
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const key = flag === '--check' ? 'check' : flags[flag];
    ensure(key && !Object.hasOwn(options, key), 'unknown_or_duplicate_argument');
    if (flag === '--check') options.check = true;
    else {
      const value = args[++index];
      ensure(typeof value === 'string' && !value.startsWith('--'), 'missing_argument_value');
      if (key.startsWith('expected') && key !== 'expectedSourceSha') {
        ensure(/^(0|[1-9][0-9]*)$/.test(value), 'invalid_expected_inventory');
        options[key] = Number(value);
      } else options[key] = value;
    }
  }
  return options;
}

function validateOptions(options) {
  const allowed = ['root', 'approvedSha256', 'expectedSourceSha', 'logDirectory', 'expectedPublicTables', 'expectedBuckets', 'check'];
  ensure(Object.keys(options).every((key) => allowed.includes(key)), 'unsupported_option');
  ensure(typeof options.approvedSha256 === 'string' && /^[a-f0-9]{64}$/.test(options.approvedSha256), 'external_approval_hash_required');
  ensure(typeof options.expectedSourceSha === 'string' && /^[a-f0-9]{40}$/.test(options.expectedSourceSha), 'expected_source_sha_required');
  ensure(Number.isSafeInteger(options.expectedPublicTables) && options.expectedPublicTables > 0 &&
    Number.isSafeInteger(options.expectedBuckets) && options.expectedBuckets >= 0, 'invalid_expected_inventory');
  ensure(options.check === undefined || typeof options.check === 'boolean', 'invalid_check_option');
}

// The leaf must already exist with private permissions. No chmod or directory
// creation changes an existing user's filesystem; links in any ancestor fail.
export function validateRestoreLogDirectory(root, directory) {
  ensure(typeof directory === 'string' && isAbsolute(directory), 'absolute_private_log_directory_required');
  directory = resolve(directory);
  const location = relative(resolve(root), directory);
  ensure(location.startsWith(`..${sep}`) || isAbsolute(location), 'logs_must_be_outside_checkout');
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current);
    ensure(!stat.isSymbolicLink() && stat.isDirectory(), 'linked_or_invalid_log_directory');
  }
  const stat = lstatSync(directory);
  if (process.platform === 'linux') ensure(stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, 'log_directory_not_private');
  return directory;
}

function openPrivate(path) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || (process.platform === 'linux' && (stat.mode & 0o777) !== 0o600)) {
    closeSync(fd);
    throw new RestoreFailure('private_log_creation_failed');
  }
  return fd;
}

function writePrivate(path, value) {
  const fd = openPrivate(path);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
}

// Dependency injection is only for isolated process simulation in unit tests.
// The command line always uses the real platform, fixed local socket and binaries.
export function restoreLocalStagingBaseline(options = {}, { run = execFileSync, platform = process.platform } = {}) {
  let stage = 'arguments';
  let transactionCompleted = false;
  let privateLog;
  let resultPath;
  let identity = {};
  const startedAtUtc = new Date().toISOString();
  try {
    validateOptions(options);
    ensure(platform === 'linux', 'linux_required');
    const root = resolve(options.root ?? repositoryRoot);
    const { approvedSha256, expectedSourceSha, expectedPublicTables, expectedBuckets } = options;
    identity = { approvalSha256: approvedSha256, sourceSha: expectedSourceSha };
    const command = (executable, args, extra = {}) => run(executable, args, {
      cwd: root, env: localEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000, maxBuffer: 2 * 1024 * 1024, ...extra,
    });
    const checkout = () => {
      ensure(command('/usr/bin/git', ['rev-parse', 'HEAD']).trim() === expectedSourceSha &&
        command('/usr/bin/git', ['status', '--porcelain', '--untracked-files=normal']).trim() === '', 'checkout_changed');
    };
    stage = 'source_identity';
    checkout();
    stage = 'prepared_files';
    verifyLocalStaging({ root, approvedSha256 });
    const baseline = loadPreparedLocalBaseline({ root, approvedSha256 });
    stage = 'private_log_directory';
    const logDirectory = validateRestoreLogDirectory(root, options.logDirectory);
    stage = 'empty_runtime_preflight';
    let health;
    try {
      health = JSON.parse(command(process.execPath, [join(root, 'scripts/verify-local-staging-runtime.mjs'),
        '--baseline-approval-sha256', approvedSha256], { timeout: 120_000 }));
    } catch {
      throw new RestoreFailure('empty_runtime_preflight_failed');
    }
    ensure(health.project === project && health.state === 'reviewed-baseline-preparation-verified' &&
      health.baselineApprovalSha256 === approvedSha256 && health.publicTableCount === 0 &&
      health.sourceSha === expectedSourceSha && health.workingTreeClean === true && health.applicationReady === false &&
      health.network?.exclusive === true && health.network?.defaultBinding === '127.0.0.1', 'empty_runtime_preflight_failed');
    stage = 'restore_input';
    const sql = buildLocalBaselineRestoreSql(baseline, expectedPublicTables, expectedBuckets);
    identity = { ...identity, restoreInputSha256: hash(sql),
      artifacts: baseline.approval.artifacts.map(({ filename, sha256, bytes }) => ({ filename, sha256, bytes })),
      expectedCounts: { publicTables: expectedPublicTables, buckets: expectedBuckets } };
    stage = 'prepared_files_after_preflight';
    verifyLocalStaging({ root, approvedSha256 });
    checkout();
    if (options.check) return { ok: true, state: 'baseline-restore-preflight-verified', ...identity,
      applicationReady: false, approvedFlows: [], catalogCompared: false, forwardsApplied: 0, sqlExecuted: false };
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    validateRestoreLogDirectory(root, logDirectory);
    privateLog = join(logDirectory, `restore-${runId}.private.log`);
    resultPath = join(logDirectory, `restore-${runId}.json`);
    writePrivate(join(logDirectory, `restore-${runId}.preflight.json`), health);
    const fd = openPrivate(privateLog);
    stage = 'transactional_restore';
    try {
      // Reviewed SQL may reset server timeouts; this is an external process limit.
      // A timeout cannot prove rollback, so the failure result never claims it.
      command('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', 'exec', '-i', container,
        'psql', '-X', '--no-password', '-U', 'supabase_admin', '-d', 'postgres', '-q',
        '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--file', '-'],
      { input: sql, stdio: ['pipe', fd, fd], timeout: 300_000 });
      transactionCompleted = true;
    } catch {
      throw new RestoreFailure('transaction_failed_or_timed_out');
    } finally { closeSync(fd); }
    stage = 'post_restore_inventory';
    const counts = JSON.parse(command('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', 'exec',
      '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000', container,
      'psql', '-X', '--no-password', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', restoreInventorySql]));
    ensure(validRestoreCounts(counts, expectedPublicTables, expectedBuckets), 'post_restore_inventory_mismatch');
    const result = { ok: true, startedAtUtc, completedAtUtc: new Date().toISOString(), project, container,
      ...identity, state: 'baseline-restored-comparison-pending', applicationReady: false, approvedFlows: [],
      catalogCompared: false, forwardsApplied: 0, publicDataCheckedEmptyInTransaction: true, counts,
      privateLog, privateLogSha256: hash(readFileSync(privateLog)) };
    writePrivate(resultPath, result);
    return result;
  } catch (error) {
    const result = { ok: false, startedAtUtc, completedAtUtc: new Date().toISOString(), project, ...identity,
      stage, code: error instanceof RestoreFailure ? error.code : 'restore_failed',
      state: 'restore-incomplete', transactionCompleted, applicationReady: false, approvedFlows: [],
      catalogCompared: false, forwardsApplied: 0, ...(privateLog ? { privateLog } : {}) };
    if (resultPath) { try { writePrivate(resultPath, result); } catch { /* Never expose raw filesystem/SQL output. */ } }
    return result;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  let result;
  try { result = restoreLocalStagingBaseline(parseRestoreArguments(process.argv.slice(2))); }
  catch (error) { result = { ok: false, state: 'restore-incomplete', applicationReady: false,
    code: error instanceof RestoreFailure ? error.code : 'invalid_arguments' }; }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
