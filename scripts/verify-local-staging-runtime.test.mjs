import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareLocalStaging, verifyLocalStaging } from './prepare-local-staging.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = join(repo, 'scripts/verify-local-staging-runtime.mjs');
const source = readFileSync(verifierPath, 'utf8');
// Execute the original verifier body with only OS/process/HTTP boundaries simulated.
// The file validator below is real. This is unit coverage, never runtime/CI approval.
assert.equal((source.match(/^import .+;\r?\n/gm) ?? []).length, 7);
const body = source.replace(/^import .+;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(verifierPath).href));
const environmentKeys = ['DOCKER_HOST', 'HOME', 'LANG', 'PATH', 'SUPABASE_NO_UPDATE_NOTIFIER', 'SUPABASE_TELEMETRY_DISABLED'];

function fixture(t, cachedValue) {
  const directory = mkdtempSync(join(tmpdir(), 'agvlog-runtime-env-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}agvlog-runtime-env-test-`));
    rmSync(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'repo');
  mkdirSync(join(root, 'infra/local-staging'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { supabase: '2.116.0' } }));
  writeFileSync(join(root, 'infra/local-staging/config.toml'), readFileSync(join(repo, 'infra/local-staging/config.toml')));
  prepareLocalStaging({ root });
  const output = join(root, '.local-staging');
  const metadata = join(output, 'supabase/.temp/cli-latest');
  const cache = (value) => { mkdirSync(dirname(metadata), { recursive: true }); writeFileSync(metadata, value); };
  if (cachedValue !== undefined) cache(cachedValue);
  return { directory, root, output, metadata, cache };
}

async function simulateVerifier(t, options = {}) {
  const f = fixture(t, options.cachedValue);
  const calls = [], outputs = [], urls = [];
  const project = 'agvlog-local-staging', networkName = 'agvlog-local-staging-loopback';
  const services = ['auth', 'db', 'inbucket', 'kong', 'pg_meta', 'realtime', 'rest', 'storage', 'studio'];
  const ids = services.map((_, index) => String(index + 1).repeat(64));
  const ports = { db: ['5432/tcp', '55322'], kong: ['8000/tcp', '55321'], studio: ['3000/tcp', '55323'], inbucket: ['8025/tcp', '55324'] };
  const processSimulation = { platform: 'linux', execPath: process.execPath, argv: [process.execPath, verifierPath],
    env: { HOME: f.directory, SUPABASE_ACCESS_TOKEN: 'synthetic-excluded-parent', PGPASSWORD: 'synthetic-excluded-parent',
      ...(options.parentFlags ?? {}) }, exitCode: undefined };
  const manifest = join(f.output, 'manifest.json');
  const before = { bytes: readFileSync(manifest), mtime: lstatSync(manifest).mtimeMs,
    ...(options.cachedValue !== undefined ? { cacheBytes: readFileSync(f.metadata), cacheMtime: lstatSync(f.metadata).mtimeMs } : {}) };
  const execFileSync = (command, args, config) => {
    // VM arrays have a different prototype; normalize at the simulated boundary.
    args = Array.from(args);
    calls.push({ command, args, env: { ...config.env } });
    assert.equal(config.cwd, repo);
    if (command === process.execPath) {
      assert.equal(args[0], join(repo, 'node_modules/supabase/dist/supabase.js'));
      if (options.cliFailure) throw new Error('synthetic-private-output-not-for-receipt');
      if (args[1] === '--version') return '2.116.0';
      assert.deepEqual(args.slice(1), ['status', '--workdir', '.local-staging', '-o', 'json']);
      if (config.env.SUPABASE_NO_UPDATE_NOTIFIER !== '1' || options.forceEmptyDuringStatus) f.cache('');
      return JSON.stringify({ API_URL: 'http://127.0.0.1:55321', ANON_KEY: 'synthetic-public-key' });
    }
    if (command === '/usr/bin/git') return args[0] === 'rev-parse' ? 'b'.repeat(40) : '';
    assert.equal(command, '/usr/bin/docker');
    assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    const commandArgs = args.slice(2);
    if (commandArgs[0] === 'version') return '29.1.3';
    if (commandArgs[0] === 'ps') return ids.join('\n');
    if (commandArgs[0] === 'inspect') return services.map((service, index) => JSON.stringify({
      id: ids[index], name: `/supabase_${service}_${project}`, image: `public.example.invalid/${service}:qualified`,
      imageId: `sha256:${ids[index]}`, project, running: true, status: 'running',
      health: service === 'rest' ? null : 'healthy', startedAt: '2026-10-14T09:04:12Z', restartCount: 0,
      ports: ports[service] ? { [ports[service][0]]: [{ HostIp: '127.0.0.1', HostPort: ports[service][1] }] } : {},
      networkMode: networkName, networks: { [networkName]: { NetworkID: 'a'.repeat(64) } },
    })).join('\n');
    if (commandArgs[0] === 'network') return JSON.stringify([{ Name: networkName, Id: 'a'.repeat(64),
      Driver: 'bridge', Scope: 'local', Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
      Containers: Object.fromEntries(ids.map((id) => [id, {}])) }]);
    assert.equal(commandArgs[0], 'exec');
    assert.ok(commandArgs.includes('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000'));
    return JSON.stringify({ version: '17.6', versionNum: 170006, publicTableCount: 0 });
  };
  const verifyFiles = (options) => {
    assert.equal(options.root, repo);
    return verifyLocalStaging({ root: f.root });
  };
  const result = new Script(`(async () => { ${body}\n })()`, { filename: verifierPath }).runInNewContext({
    execFileSync, createHash, readFileSync, dirname, join, resolve, fileURLToPath,
    process: processSimulation, console: { log: (value) => outputs.push(JSON.parse(value)) },
    LOCAL_STAGING_CLI_VERSION: '2.116.0', verifyLocalStaging: verifyFiles,
    verifyLocalStagingApplicationTransition: () => { throw new Error('application mode not part of this unit fixture'); },
    applicationInventorySql: '', applicationHookProbeSql: '', validApplicationInventory: () => false,
    URL, AbortSignal, fetch: async (url) => { urls.push(url); return { status: 200, body: { cancel: async () => {} } }; },
  }, { timeout: 5000 });
  await result;
  assert.equal(outputs.length, 1);
  assert.deepEqual(readFileSync(manifest), before.bytes);
  assert.equal(lstatSync(manifest).mtimeMs, before.mtime);
  return { ...f, before, calls, urls, result: outputs[0], exitCode: processSimulation.exitCode };
}

test('verifier forces notifier and telemetry off for every child without inheriting parent credentials', async (t) => {
  for (const parentFlags of [{}, { SUPABASE_NO_UPDATE_NOTIFIER: '0', SUPABASE_TELEMETRY_DISABLED: '0' }]) {
    const f = await simulateVerifier(t, { parentFlags });
    assert.equal(f.result.state, 'empty-infrastructure-verified');
    assert.equal(f.result.applicationReady, false);
    assert.deepEqual(f.result.approvedFlows, []);
    assert.equal(f.exitCode, undefined);
    assert.equal(f.urls.length, 4);
    assert.ok(f.calls.some((call) => call.command === process.execPath && call.args[1] === 'status'));
    for (const { env } of f.calls) {
      assert.deepEqual(Object.keys(env).sort(), environmentKeys);
      assert.equal(env.SUPABASE_NO_UPDATE_NOTIFIER, '1');
      assert.equal(env.SUPABASE_TELEMETRY_DISABLED, '1');
      assert.equal(env.DOCKER_HOST, 'unix:///var/run/docker.sock');
    }
    assert.throws(() => lstatSync(f.metadata), { code: 'ENOENT' });
  }
});

test('verifier preserves existing canonical metadata bytes and mtime through CLI reads', async (t) => {
  const f = await simulateVerifier(t, { cachedValue: 'v2.118.0' });
  assert.equal(f.result.state, 'empty-infrastructure-verified');
  assert.deepEqual(readFileSync(f.metadata), f.before.cacheBytes);
  assert.equal(lstatSync(f.metadata).mtimeMs, f.before.cacheMtime);
});

test('verifier still refuses an existing empty notifier cache before any process or HTTP probe', async (t) => {
  const f = await simulateVerifier(t, { cachedValue: '' });
  assert.equal(f.result.state, 'runtime-verification-failed');
  assert.equal(f.result.stage, 'prepared_files');
  assert.equal(f.exitCode, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.urls.length, 0);
  assert.equal(readFileSync(f.metadata).length, 0);
  assert.equal(lstatSync(f.metadata).mtimeMs, f.before.cacheMtime);
  assert.throws(() => verifyLocalStaging({ root: f.root }), /Invalid local CLI metadata size/);
});

test('verifier still fails closed when a simulated CLI creates empty cache during status', async (t) => {
  const f = await simulateVerifier(t, { forceEmptyDuringStatus: true });
  assert.equal(f.result.state, 'runtime-verification-failed');
  assert.equal(f.result.stage, 'prepared_files_after_status');
  assert.equal(f.result.applicationReady, false);
  assert.equal(f.exitCode, 1);
  assert.equal(readFileSync(f.metadata).length, 0);
  assert.throws(() => verifyLocalStaging({ root: f.root }), /Invalid local CLI metadata size/);
});

test('verifier redacts subprocess failures and retains fail-closed state', async (t) => {
  const f = await simulateVerifier(t, { cliFailure: true });
  assert.equal(f.result.state, 'runtime-verification-failed');
  assert.equal(f.result.stage, 'versions');
  assert.equal(f.result.code, 'command_failed_or_timed_out');
  assert.equal(f.exitCode, 1);
  assert.equal(f.urls.length, 0);
  assert.doesNotMatch(JSON.stringify(f.result), /synthetic-private-output/);
});
