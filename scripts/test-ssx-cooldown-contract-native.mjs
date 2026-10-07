// Own ephemeral PostgreSQL only. No Supabase stack, credentials, host ports or volumes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const imageTag = 'public.ecr.aws/supabase/postgres:17.6.1.165';
const label = 'agvlog-ssx-cooldown-' + randomUUID();
const dockerPrefix = process.platform === 'win32' ? ['-d', 'Ubuntu-24.04', '--exec', 'docker'] : [];
const command = process.platform === 'win32' ? 'wsl.exe' : 'docker';
const pgBin = '/nix/var/nix/profiles/default/bin/';
let containerId;
const evidence = { scope: 'owned-partial-native-postgresql-fixture', image: '', checks: [], cleanup: false };

function start(args, input = '', timeoutMs = 30_000) {
  const child = spawn(command, [...dockerPrefix, ...args], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  const result = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Own fixture command timed out')); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolveResult({ code, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
  child.stdin.on('error', () => { /* process may reject SQL early */ });
  child.stdin.end(input);
  return result;
}
async function checked(args, input = '', timeoutMs) {
  const result = await start(args, input, timeoutMs);
  if (result.code !== 0) throw Error('Own fixture failed: ' + result.stderr);
  return result.stdout;
}
function sql(text, applicationName = 'ssx-fixture-check') {
  assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
  return checked(['exec', '-i', '-e', 'PGAPPNAME=' + applicationName, containerId,
    pgBin + 'psql', '-X', '--no-password', '-h', '/tmp/ssx', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atq'], text);
}
const read = path => readFileSync(resolve(root, path), 'utf8');
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
async function until(check, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await delay(75); }
  throw Error('Own native fixture observation timed out');
}
function pass(name) { evidence.checks.push(name); }
const ids = {
  tenant: '21000000-0000-4000-8000-000000000001', otherTenant: '21000000-0000-4000-8000-000000000002',
  account: '22000000-0000-4000-8000-000000000001', unit: '23000000-0000-4000-8000-000000000001',
  link: '24000000-0000-4000-8000-000000000001', vehicle: '25000000-0000-4000-8000-000000000001',
};
const observed = new Date(Date.now() - 10_000).toISOString();
const untilAt = seconds => new Date(Date.parse(observed) + seconds * 1000).toISOString();
const account = (seconds, tenant = ids.tenant) => `public.record_ssx_account_cooldown_v1('${tenant}','${ids.account}',
  '${observed}','${untilAt(seconds)}','QA rate limited')`;
const unit = seconds => `public.record_ssx_poll_error_v1('${ids.tenant}','${ids.account}','${ids.unit}',
  '${ids.link}','${ids.vehicle}','${observed}','QA rate limited','${untilAt(seconds)}','{}')`;
async function expectedError(expression, role = 'service_role', code = '22023', zone = 'UTC') {
  const result = await start(['exec', '-i', containerId, pgBin + 'psql', '-X', '--no-password', '-h', '/tmp/ssx',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'],
  `set timezone='${zone}'; set role ${role}; select ${expression};`);
  assert.notEqual(result.code, 0);
  assert.ok(result.stderr.includes(code), 'Expected SQLSTATE ' + code + ', got: ' + result.stderr);
}

try {
  // Immutable cached image; --pull never prevents remote/image changes.
  const imageId = await checked(['image', 'inspect', imageTag, '--format', '{{.Id}}']);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/); evidence.image = imageId;
  const boot = 'mkdir /tmp/ssx && ' + pgBin + 'initdb -D /tmp/ssx/data -U postgres --auth=trust --no-locale --encoding=UTF8 >/tmp/ssx/init.log && exec ' +
    pgBin + 'postgres -D /tmp/ssx/data -k /tmp/ssx -c listen_addresses= -c shared_buffers=32MB -c max_connections=8';
  containerId = await checked(['run', '--rm', '--detach', '--pull', 'never', '--network', 'none', '--read-only',
    '--user', '100:101', '--tmpfs', '/tmp:rw,uid=100,gid=101,mode=0700,size=384m', '--shm-size', '64m',
    '--memory', '768m', '--pids-limit', '128', '--cpus', '1', '--name', label, '--label', 'agvlog.task=' + label,
    '--entrypoint', '/bin/sh', imageId, '-c', boot]);
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const ownLabel = await checked(['inspect', containerId, '--format', '{{index .Config.Labels "agvlog.task"}}']);
  assert.equal(ownLabel, label);
  assert.equal(await checked(['inspect', containerId, '--format', '{{.HostConfig.NetworkMode}}']), 'none');
  assert.ok(['null', '{}'].includes(await checked(['inspect', containerId, '--format', '{{json .HostConfig.PortBindings}}'])));
  assert.equal(await checked(['inspect', containerId, '--format', '{{json .Mounts}}']), '[]');
  await until(async () => (await start(['exec', containerId, pgBin + 'pg_isready', '-h', '/tmp/ssx', '-U', 'postgres'])).code === 0, 30_000);
  pass('owned image / network none / no ports / no persistent mounts');

  const baseline = read('supabase/migrations/20260824224152_baseline.sql');
  const tables = ['tenants', 'vehicles', 'integration_accounts', 'provider_units', 'vehicle_tracker_links',
    'tenant_feature_policy', 'positions_raw', 'positions_last', 'ingestion_cursors', 'vehicle_processing_queue'];
  let setup = 'create role anon; create role authenticated; create role service_role;\n';
  for (const name of tables) {
    const ddl = baseline.match(new RegExp('CREATE TABLE public\\.' + name + ' \\([\\s\\S]*?\\n\\);'))?.[0];
    assert.ok(ddl, 'Missing fixture table ' + name); setup += ddl + '\n';
    for (const statement of baseline.match(new RegExp('ALTER TABLE ONLY public\\.' + name + '\\s+ALTER COLUMN[\\s\\S]*?;', 'g')) ?? []) setup += statement + '\n';
    for (const statement of baseline.match(new RegExp('ALTER TABLE ONLY public\\.' + name + '\\s+ADD CONSTRAINT[\\s\\S]*?;', 'g')) ?? []) {
      if (/PRIMARY KEY|UNIQUE /.test(statement) && !/FOREIGN KEY/.test(statement)) setup += statement + '\n';
    }
  }
  setup += 'grant select,insert,update,delete on table ' + tables.map(name => 'public.' + name).join(',') + ' to service_role;\n';
  setup += read('supabase/migrations/20260831211632_make_ssx_position_ingestion_monotonic.sql') + '\n';
  setup += read('supabase/migrations/20260915055000_ssx_account_recovery_rpc.sql') + '\n';
  setup += `insert into tenants(id,name) values('${ids.tenant}','Tenant QA'),('${ids.otherTenant}','Other QA');
    insert into vehicles(id,tenant_id,plate) values('${ids.vehicle}','${ids.tenant}','QA-1000');
    insert into integration_accounts(id,tenant_id,provider,base_url,username,password_encrypted,status)
      values('${ids.account}','${ids.tenant}','SSX','https://ssx.invalid','qa','enc:v1:qa','ok');
    insert into provider_units(id,tenant_id,integration_account_id,external_code,active)
      values('${ids.unit}','${ids.tenant}','${ids.account}','UNIT-QA',true);
    insert into vehicle_tracker_links(id,tenant_id,vehicle_id,provider_unit_id,active,start_at)
      values('${ids.link}','${ids.tenant}','${ids.vehicle}','${ids.unit}',true,now()-interval '1 day');
    insert into tenant_feature_policy(tenant_id,feature_key,enabled)
      values('${ids.tenant}','ssx_enabled',true),('${ids.tenant}','ssx_kill_switch',false);`;
  await sql(setup);
  evidence.postgres = await sql('show server_version;');
  await expectedError(account(7200)); pass('predecessor rejects valid two-hour wait with SQLSTATE 22023');
  const snapshotSql = `select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
    'config',p.proconfig,'security_definer',p.prosecdef,'argnames',p.proargnames,'hash',md5(replace(p.prosrc,E'\\r\\n',E'\\n')))
    order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('record_ssx_account_cooldown_v1','record_ssx_poll_error_v1');`;
  const before = JSON.parse(await sql(snapshotSql));
  const forward = read('supabase/migrations/20261006155532_align_ssx_cooldown_retry_after_contract.sql');
  const rollback = read('docs/qa/ssx-account-cooldown-retry-after-rollback-2026-10-06.sql');
  await sql(forward);
  const after = JSON.parse(await sql(snapshotSql));
  assert.deepEqual(after.map(({ hash: _hash, ...metadata }) => metadata), before.map(({ hash: _hash, ...metadata }) => metadata));
  assert.deepEqual(after.map(row => row.hash).sort(), ['ad385a5fa7b2db14364b3d6ef4de3922', '744cf7391b0a9d8f9287d307ef347ef1'].sort());
  await sql(forward); assert.deepEqual(JSON.parse(await sql(snapshotSql)), after);
  pass('native guarded migration preserves OIDs / ACL / invoker / argument names; idempotent');
  for (const seconds of [3601, 7200, 86400]) {
    const receipt = JSON.parse(await sql(`set role service_role; select ${account(seconds)};`));
    assert.equal(receipt.version, 1);
    await sql(`set role service_role; select ${unit(seconds)};`);
  }
  pass('both native RPCs accept 3601 / 7200 / 86400 elapsed seconds');
  for (const zone of ['UTC', 'America/New_York']) {
    for (const date of ['2026-03-08T06:30:00Z', '2025-11-02T04:30:00Z']) {
      await sql(`set timezone='${zone}'; set role service_role;
        select public.record_ssx_poll_error_v1('${ids.tenant}','${ids.account}','${ids.unit}','${ids.link}',
          '${ids.vehicle}','${date}','QA','${date}'::timestamptz+interval '24 hours','{}');
        select public.record_ssx_account_cooldown_v1('${ids.tenant}','${ids.account}','${date}',
          '${date}'::timestamptz+interval '24 hours','QA');`);
      await expectedError(`public.record_ssx_poll_error_v1('${ids.tenant}','${ids.account}','${ids.unit}',
        '${ids.link}','${ids.vehicle}','${date}','QA','${date}'::timestamptz+interval '24 hours 0.001 seconds','{}')`, 'service_role', '22023', zone);
      await expectedError(`public.record_ssx_account_cooldown_v1('${ids.tenant}','${ids.account}','${date}',
        '${date}'::timestamptz+interval '24 hours 0.001 seconds','QA')`, 'service_role', '22023', zone);
    }
  }
  pass('24 elapsed hours / millisecond overflow at UTC and DST transitions');
  await expectedError(account(86401)); await expectedError(unit(86401));
  await expectedError(account(7200).replace(untilAt(7200), 'infinity'));
  await expectedError(unit(7200).replace(untilAt(7200), '-infinity'));
  await expectedError(account(-1)); await expectedError(account(120, ids.otherTenant));
  pass('out-of-range / nonfinite / reversed / tenant mismatch fail closed');
  for (const role of ['anon', 'authenticated']) {
    await expectedError(account(120), role, '42501'); await expectedError(unit(120), role, '42501');
  }
  await sql(`update tenant_feature_policy set enabled=false where feature_key='ssx_enabled';`);
  await expectedError(account(120), 'service_role', '42501');
  await sql(`update tenant_feature_policy set enabled=true where feature_key='ssx_enabled';`);
  pass('service-only ACL and disabled account capability guard remain enforced');

  // Real sessions and observed lock waits, not Promise serialization in PGlite.
  await sql('update integration_accounts set poll_cooldown_until=null;');
  const longWriter = sql(`begin; set role service_role; select ${account(7200)};
    reset role; select pg_sleep(4); commit;`, 'ssx-fixture-long');
  await until(async () => await sql("select count(*) from pg_stat_activity where application_name='ssx-fixture-long' and wait_event='PgSleep';") === '1');
  const shortWriter = sql(`set role service_role; select ${account(120)};`, 'ssx-fixture-short');
  await until(async () => await sql("select count(*) from pg_stat_activity where application_name='ssx-fixture-short' and wait_event_type='Lock';") === '1');
  const concurrent = await Promise.all([longWriter, shortWriter]);
  assert.equal(Date.parse(JSON.parse(concurrent[1]).cooldown_until), Date.parse(untilAt(7200)));
  assert.equal(Number(await sql('select extract(epoch from poll_cooldown_until)*1000 from integration_accounts;')), Date.parse(untilAt(7200)));
  pass('two native sessions: shorter writer waits on row lock and retains longest account deadline');
  await sql('delete from ingestion_cursors;'); // Own synthetic fixture only.
  const unitWriter = sql(`begin; set role service_role; select ${unit(7200)};
    reset role; select pg_sleep(4); commit;`, 'ssx-fixture-unit-long');
  await until(async () => await sql("select count(*) from pg_stat_activity where application_name='ssx-fixture-unit-long' and wait_event='PgSleep';") === '1');
  const olderObserved = new Date(Date.parse(observed) - 1000).toISOString();
  const olderUntil = new Date(Date.parse(olderObserved) + 120_000).toISOString();
  const staleUnit = unit(120).replace(observed, olderObserved).replace(untilAt(120), olderUntil);
  const staleUnitWriter = sql(`set role service_role; select ${staleUnit};`, 'ssx-fixture-unit-stale');
  await until(async () => await sql("select count(*) from pg_stat_activity where application_name='ssx-fixture-unit-stale' and wait_event_type='Lock';") === '1');
  await Promise.all([unitWriter, staleUnitWriter]);
  assert.equal(Number(await sql('select extract(epoch from backoff_until)*1000 from ingestion_cursors;')), Date.parse(untilAt(7200)));
  assert.equal(Number(await sql('select extract(epoch from last_error_at)*1000 from ingestion_cursors;')), Date.parse(observed));
  pass('two native unit sessions: stale writer waits on advisory lock and preserves newer backoff / error');
  const recovery = JSON.parse(await sql(`set role service_role; select public.clear_ssx_account_cooldown_v1(
    '${ids.tenant}','${ids.account}','${new Date(Date.parse(observed) - 1000).toISOString()}');`));
  assert.equal(recovery.cleared, false);
  assert.equal(Number(await sql('select extract(epoch from poll_cooldown_until)*1000 from integration_accounts;')), Date.parse(untilAt(7200)));
  pass('stale recovery never clears an active newer cooldown');
  const counts = await sql(`select (select count(*) from positions_raw),(select count(*) from positions_last),
    (select count(*) from vehicle_processing_queue),(select count(*) from ingestion_cursors where last_success_at is not null);`);
  assert.equal(counts, '0|0|0|0'); pass('error paths never advance position history / cursor success / queue');
  const deadlines = await sql('select poll_cooldown_until from integration_accounts; select backoff_until from ingestion_cursors;');
  await sql(rollback);
  assert.deepEqual(JSON.parse(await sql(snapshotSql)), before);
  assert.equal(await sql('select poll_cooldown_until from integration_accounts; select backoff_until from ingestion_cursors;'), deadlines);
  await expectedError(account(7200)); await sql(forward);
  pass('guarded rollback / reapply preserve active long deadlines and original ACLs');
} finally {
  if (containerId) {
    const ownLabel = await checked(['inspect', containerId, '--format', '{{index .Config.Labels "agvlog.task"}}']);
    assert.equal(ownLabel, label, 'Cleanup may target only this script\'s owned container');
    await checked(['stop', '--time', '1', containerId]); evidence.cleanup = true;
  }
}
console.log(JSON.stringify(evidence, null, 2));
