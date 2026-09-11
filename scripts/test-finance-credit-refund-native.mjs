import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
// Disposable native PostgreSQL; never connects to a configured application database.
// Run with Node 22: node --experimental-strip-types scripts/test-delivery-concurrency.mjs
// PG_QA_BIN may point to an existing, trusted PostgreSQL 17 bin directory.
const cache = resolve('node_modules/.cache/qa-postgres');
const bin = process.env.PG_QA_BIN || join(cache, 'runtime-17.11/pgsql/bin');
const exe = (name) => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
for (const name of ['initdb', 'pg_ctl', 'psql']) {
  if (!existsSync(exe(name))) throw new Error(`Missing ${exe(name)}; supply PG_QA_BIN. No automatic download.`);
}
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, 'delivery-concurrency-'));
const cluster = join(directory, 'data');
const passwordFile = join(directory, 'init-password');
const password = randomBytes(32).toString('hex');
const listener = createServer();
await new Promise((res, rej) => { listener.once('error', rej); listener.listen(0, '127.0.0.1', res); });
const port = listener.address().port;
await new Promise((res, rej) => listener.close((error) => error ? rej(error) : res()));
const env = { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable' };
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  '-h', '127.0.0.1', '-p', String(port), '-U', 'qa', '-d', 'postgres'];
const active = new Set();
const literal = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const identity = ''; 
const asDriver = 'set role authenticated;';

function session(name, database = 'postgres') {
  const databaseArgs = [...args]; databaseArgs[databaseArgs.length - 1] = database;
  const child = spawn(exe('psql'), databaseArgs, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { child, output: '', error: '', exited: false, code: null };
  active.add(state);
  child.stdout.on('data', (chunk) => { state.output += chunk; });
  child.stderr.on('data', (chunk) => { state.error += chunk; });
  // psql exits immediately on an expected SQL rejection (ON_ERROR_STOP). A write
  // racing that exit must not crash Node before the disposable server is stopped.
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') state.error += `\nstdin: ${error.message}`;
  });
  state.done = new Promise((res, rej) => {
    child.once('error', rej);
    child.once('exit', (code) => { state.exited = true; state.code = code; active.delete(state); res(state); });
  });
  state.send = (sql) => child.stdin.write(`${sql}\n`);
  state.send(`set application_name=${literal(name)}; set statement_timeout='8s'; set lock_timeout='6s';`);
  return state;
}
async function finish(state, sql, success = true) {
  if (!state.exited && !state.child.stdin.destroyed && !state.child.stdin.writableEnded) state.child.stdin.end(`${sql}\n\\q\n`);
  const timeout = setTimeout(() => state.child.kill(), 12_000);
  try { await state.done; } finally { clearTimeout(timeout); }
  if (success) assert.equal(state.code, 0, state.error);
  return state;
}

async function query(sql, database = 'postgres') {
  return (await finish(session('delivery-qa-query', database), sql)).output.trim();
}

async function waitForMarker(state, marker) {
  const deadline = Date.now() + 6000;
  while (!state.output.includes(marker)) {
    assert.ok(!state.exited, `Session exited before ${marker}: ${state.error}`);
    assert.ok(Date.now() < deadline, `Timed out waiting for ${marker}: ${state.error}`);
    await delay(25);
  }
}

async function contested(holderSql, waiterSql, { driver = true, waiterSucceeds = true, holderAfterBlocked = '', waitForBlocking = true, database = 'postgres' } = {}) {
  const holder = session('delivery-qa-holder',database);
  holder.send(`begin; ${driver ? asDriver : identity} ${holderSql}; select '__HOLDER_READY__';`);
  await waitForMarker(holder, '__HOLDER_READY__');
  const waiter = session('delivery-qa-waiter',database);
  waiter.send(`begin; ${driver ? asDriver : identity} ${waiterSql}; commit;`);
  if (!waitForBlocking) {const result=await finish(waiter,'',waiterSucceeds);await finish(holder,`${holderAfterBlocked}; commit;`);return result;}
  const deadline = Date.now() + 4500;
  let overlap = false;
  while (!overlap && Date.now() < deadline) {
    const blocked = await query(`select exists(select 1 from pg_stat_activity w
      join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid))
      where w.application_name='delivery-qa-waiter' and h.application_name='delivery-qa-holder');`);
    overlap = blocked === 't';
    if (!overlap) {
      assert.ok(!waiter.exited, `Waiter failed before overlap: ${waiter.error}`);
      await delay(25);
    }
  }
  assert.ok(overlap, 'The competing write did not block on the held graph. Race reproduced.');
  await finish(holder, `${holderAfterBlocked}; commit;`);
  const result = await finish(waiter, '', waiterSucceeds);
  if (!waiterSucceeds) assert.notEqual(result.code, 0, 'Conflicting write unexpectedly committed');
  return result;
}

let started = false;
try {
  // Generated, throwaway local credential, removed immediately after initdb.
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600, flag: 'wx' });
  const initialized = spawnSync(exe('initdb'), ['-D', cluster, '-U', 'qa', `--pwfile=${passwordFile}`,
    '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-sync'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  unlinkSync(passwordFile);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.error?.message);
  const launched = spawnSync(exe('pg_ctl'), ['start', '-D', cluster, '-l', join(directory, 'server.log'),
    '-o', `-h 127.0.0.1 -p ${port} -c max_connections=12 -c shared_buffers=32MB`, '-t', '10', '-w'],
  { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  started = existsSync(join(cluster, 'postmaster.pid'));
  assert.equal(launched.status, 0, launched.stderr || launched.error?.message);
  console.log(`Native PostgreSQL: ${await query('show server_version;')} (loopback, disposable fixture)`);
  const {runCreditRefundNative}=await import('./test-finance-credit-refund-native-cases.mjs');
  const result=await runCreditRefundNative({query,contested,literal,session,finish});console.log(`${result.passed} native cases passed; ${result.findings} functional gaps found.`);if(result.findings)process.exitCode=1;
} catch (error) {
  // Keep the original assertion visible even if cleanup has a second failure.
  console.error('Native PostgreSQL suite failed before cleanup:', error);
  throw error;
} finally {
  for (const state of active) state.child.kill();
  await Promise.allSettled([...active].map((state) => state.done));
  if (existsSync(passwordFile)) unlinkSync(passwordFile);
  if (started) {
    // Windows fsync at shutdown can exceed 10s while the coverage/build gate runs.
    const stopped = spawnSync(exe('pg_ctl'), ['stop', '-D', cluster, '-m', 'fast', '-t', '25', '-w'],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(stopped.status, 0, `Could not stop disposable PostgreSQL: ${stopped.stderr}`);
    assert.ok(!existsSync(join(cluster, 'postmaster.pid')), 'Disposable PostgreSQL is still running');
    console.log('Disposable PostgreSQL stopped. Diagnostic files retained under node_modules/.cache/qa-postgres.');
  }
}
