import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STAGING_CLI_VERSION, verifyLocalStaging } from './prepare-local-staging.mjs';

// Verifies the reviewed EMPTY bootstrap only. Never starts, resets or stops services.
const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const project = 'agvlog-local-staging';
const networkName = 'agvlog-local-staging-loopback';
const services = ['auth', 'db', 'inbucket', 'kong', 'pg_meta', 'realtime', 'rest', 'storage', 'studio'];
const names = services.map((service) => `supabase_${service}_${project}`);
const publishedPorts = { db: ['5432/tcp', '55322'], kong: ['8000/tcp', '55321'], studio: ['3000/tcp', '55323'], inbucket: ['8025/tcp', '55324'] };
const localEnvironment = {
  PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  DOCKER_HOST: 'unix:///var/run/docker.sock',
};
let stage = 'platform';

class VerificationFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

function requireCondition(condition, code) {
  if (!condition) throw new VerificationFailure(code);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root, env: localEnvironment, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch {
    // execFileSync errors may contain complete captured output, including local keys.
    throw new VerificationFailure('command_failed_or_timed_out');
  }
}

const docker = (...args) => run('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
const cli = (...args) => run(process.execPath, [join(root, 'node_modules/supabase/dist/supabase.js'), ...args]);

function parseJson(value) {
  try { return JSON.parse(value); } catch { throw new VerificationFailure('invalid_command_json'); }
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value));
}

async function probe(path, url, headers = {}, maxRedirects = 0) {
  const expectedOrigin = new URL(url).origin;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try {
      response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
    } catch {
      throw new VerificationFailure('http_probe_failed_or_timed_out');
    }
    if (response.status === 200) return { path, status: response.status, redirects };
    requireCondition(redirects < maxRedirects && [301, 302, 303, 307, 308].includes(response.status), 'http_probe_not_200');
    let destination;
    try {
      const location = response.headers.get('location');
      requireCondition(Boolean(location), 'redirect_location_missing');
      destination = new URL(location, url);
    } catch {
      throw new VerificationFailure('invalid_redirect_location');
    }
    requireCondition(destination.origin === expectedOrigin && !destination.username && !destination.password &&
      Object.keys(headers).length === 0, 'redirect_outside_local_origin');
    url = destination.href;
  }
  throw new VerificationFailure('too_many_local_redirects');
}

try {
  requireCondition(process.platform === 'linux', 'linux_required');
  requireCondition(process.argv.length === 2, 'arguments_not_supported');
  stage = 'prepared_files';
  verifyLocalStaging({ root });

  stage = 'versions';
  const cliVersion = cli('--version');
  requireCondition(cliVersion === LOCAL_STAGING_CLI_VERSION, 'cli_version_mismatch');
  const dockerVersion = docker('version', '--format', '{{.Server.Version}}');
  requireCondition(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(dockerVersion) && Number(dockerVersion.split('.')[0]) >= 28, 'docker_version_unsupported');

  stage = 'container_inventory';
  const ids = docker('ps', '-aq', '--no-trunc', '--filter', `label=com.supabase.cli.project=${project}`).split(/\s+/).filter(Boolean);
  requireCondition(ids.length === names.length && ids.every((id) => /^[a-f0-9]{64}$/.test(id)), 'unexpected_container_inventory');
  // Request selected fields only; never retrieve Config.Env or health-check logs.
  const inspectFormat = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"ports":{{json .NetworkSettings.Ports}},"networkMode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}}}';
  const inspected = docker('inspect', '--format', inspectFormat, ...ids).split('\n').filter(Boolean).map(parseJson);
  requireCondition(sameMembers(inspected.map((item) => item.name), names.map((name) => `/${name}`)), 'unexpected_container_names');

  stage = 'network';
  const networks = parseJson(docker('network', 'inspect', networkName));
  requireCondition(Array.isArray(networks) && networks.length === 1, 'unexpected_network_inventory');
  const network = networks[0];
  requireCondition(network.Name === networkName && network.Driver === 'bridge' && network.Scope === 'local' &&
    network.Options?.['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1' &&
    [undefined, 'nat'].includes(network.Options?.['com.docker.network.bridge.gateway_mode_ipv4']) &&
    [undefined, 'nat'].includes(network.Options?.['com.docker.network.bridge.gateway_mode_ipv6']) &&
    !network.Options?.['com.docker.network.bridge.trusted_host_interfaces'] &&
    sameMembers(Object.keys(network.Containers ?? {}), ids), 'network_not_exclusive_loopback_bridge');

  stage = 'health_and_bindings';
  const containers = inspected.map((item) => {
    const name = item.name.slice(1);
    const service = services[names.indexOf(name)];
    requireCondition(item.project === project && item.running === true && item.status === 'running' &&
      (item.health === 'healthy' || (service === 'rest' && item.health === null)), 'container_unhealthy');
    requireCondition(item.networkMode === networkName && sameMembers(Object.keys(item.networks ?? {}), [networkName]) &&
      item.networks[networkName]?.NetworkID === network.Id, 'container_network_mismatch');
    const bindings = Object.entries(item.ports ?? {}).flatMap(([containerPort, values]) =>
      (values ?? []).map((binding) => ({ containerPort, hostIp: binding.HostIp, hostPort: binding.HostPort })));
    const expectedPort = publishedPorts[service];
    requireCondition(expectedPort ? bindings.length > 0 && bindings.every((binding) =>
      binding.containerPort === expectedPort[0] && binding.hostPort === expectedPort[1] &&
      ['127.0.0.1', '::1'].includes(binding.hostIp)) : bindings.length === 0, 'unexpected_published_binding');
    requireCondition(typeof item.image === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(item.image) &&
      /^sha256:[a-f0-9]{64}$/.test(item.imageId) &&
      typeof item.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(item.startedAt) &&
      Number.isInteger(item.restartCount) && item.restartCount >= 0, 'invalid_container_metadata');
    return { name, image: item.image, imageId: item.imageId, running: true,
      health: item.health ?? 'not-configured', startedAt: item.startedAt, restartCount: item.restartCount, bindings };
  }).sort((a, b) => a.name.localeCompare(b.name));

  stage = 'empty_database';
  const query = "select json_build_object('version', current_setting('server_version'), 'versionNum', current_setting('server_version_num')::int, 'publicTableCount', (select count(*) from pg_tables where schemaname = 'public'))";
  const database = parseJson(docker('exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000',
    `supabase_db_${project}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query));
  requireCondition(database.publicTableCount === 0, 'application_schema_not_empty');
  requireCondition(database.versionNum >= 170000 && database.versionNum < 180000 &&
    /^17\.\d+(?:[a-zA-Z0-9 .()+~-]*)?$/.test(database.version), 'postgres_version_mismatch');

  stage = 'local_api_identity';
  // Keep the status payload private: it contains local credentials, including privileged keys.
  const status = parseJson(cli('status', '--workdir', '.local-staging', '-o', 'json'));
  requireCondition(['http://127.0.0.1:55321', 'http://localhost:55321'].includes(status.API_URL), 'unexpected_api_origin');
  const publicKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  requireCondition(typeof publicKey === 'string' && publicKey.length >= 16 && publicKey.length <= 4096, 'public_client_key_unavailable');
  stage = 'http_probes';
  const probes = [];
  for (const path of ['/auth/v1/health', '/rest/v1/']) {
    probes.push(await probe(path, `http://127.0.0.1:55321${path}`, { apikey: publicKey }));
  }
  // Studio redirects to its default project. Follow at most three same-origin GETs, without keys.
  probes.push(await probe('studio', 'http://127.0.0.1:55323/', {}, 3));
  probes.push(await probe('mail', 'http://127.0.0.1:55324/'));

  stage = 'source_identity';
  const sourceSha = run('/usr/bin/git', ['rev-parse', 'HEAD']);
  requireCondition(/^[a-f0-9]{40}$/.test(sourceSha), 'invalid_source_identity');
  const workingTreeClean = run('/usr/bin/git', ['status', '--porcelain', '--untracked-files=normal']) === '';
  const verifierSha256 = createHash('sha256').update(readFileSync(scriptPath)).digest('hex');
  stage = 'prepared_files_after_status';
  // CLI read commands may refresh their version cache; reject any unreviewed artifact afterwards.
  verifyLocalStaging({ root });
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(), project, state: 'empty-infrastructure-verified',
    applicationReady: false, approvedFlows: [], baseline: 'pending', sourceSha, workingTreeClean,
    verifierSha256, cliVersion, dockerVersion, postgresVersion: database.version, publicTableCount: 0,
    network: { name: networkName, driver: 'bridge', exclusive: true, defaultBinding: '127.0.0.1' },
    containers, probes,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(), project, state: 'runtime-verification-failed',
    applicationReady: false, approvedFlows: [], stage,
    code: error instanceof VerificationFailure ? error.code : 'verification_failed',
  }, null, 2));
  process.exitCode = 1;
}
