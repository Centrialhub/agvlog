import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = 'infra/local-staging/config.toml';
const templateSha256 = 'df0703b59d0ecac3d5ef7fd98a3cc20c878a861afc7f84cee349a7ff01b7a021';
export const LOCAL_STAGING_CLI_VERSION = '2.116.0';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// lstat each component: checking only realpath would silently accept a junction.
function rejectLinks(path) {
  const absolute = resolve(path);
  const anchor = parse(absolute).root;
  let component = anchor;
  for (const part of absolute.slice(anchor.length).split(sep).filter(Boolean)) {
    component = join(component, part);
    const stat = statIfPresent(component);
    if (stat?.isSymbolicLink()) throw new Error('Local staging refuses symlinks or junctions.');
    if (stat?.isFile() && stat.nlink !== 1) throw new Error('Local staging refuses hard-linked files.');
  }
}

function readRegularFile(path) {
  rejectLinks(path);
  if (!lstatSync(path).isFile()) throw new Error('Expected a regular local staging source file.');
  return readFileSync(path, 'utf8');
}

function expectedFiles(root) {
  const packageJson = JSON.parse(readRegularFile(join(root, 'package.json')));
  if (packageJson.devDependencies?.supabase !== LOCAL_STAGING_CLI_VERSION) {
    throw new Error('Review the local staging template before changing the pinned Supabase CLI.');
  }
  const config = readRegularFile(join(root, templatePath)).replace(/\r\n/g, '\n');
  if (sha256(config) !== templateSha256) {
    throw new Error('Local staging template differs from its reviewed hash; preparation refused.');
  }
  const manifest = {
    formatVersion: 1,
    projectId: 'agvlog-local-staging',
    state: 'empty-infrastructure-only',
    applicationReady: false,
    approvedFlows: [],
    cliVersion: LOCAL_STAGING_CLI_VERSION,
    workdir: '.local-staging',
    template: { path: templatePath, sha256: templateSha256, encoding: 'UTF-8 LF' },
    files: { 'supabase/config.toml': { sha256: sha256(config) } },
    ports: { api: 55321, database: 55322, studio: 55323, mail: 55324, shadow: 55320, frontend: 5175 },
    baseline: { state: 'pending-authoritative-capture-and-review', artifact: null },
    protections: {
      remoteLink: 'forbidden', historicalReplay: 'disabled', seed: 'disabled',
      authHook: 'disabled-until-catalog-restored', edgeRuntime: 'disabled',
      applicationFunctions: 'not-copied', productionSecrets: 'not-copied',
      externalIntegrations: 'not-provisioned', applicationCronJobs: 'not-provisioned',
    },
    nextRequirements: [
      'Install and verify the container runtime separately; this generator never starts services.',
      'Verify loopback port bindings and an empty isolated Docker project before starting infrastructure.',
      'Capture and review the authoritative schema and required Auth/Storage customizations.',
      'Restore only reviewed artifacts with external jobs and integrations disabled; verify catalog parity.',
      'Provision synthetic fixtures and enable the reviewed Auth hook before application tests.',
      'Approve critical flows only after tests on the same candidate and backend; infrastructure is not homologation.',
    ],
  };
  return new Map([
    ['supabase/config.toml', config],
    ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
  ]);
}

function validateExistingTree(output, files) {
  rejectLinks(output);
  const stat = statIfPresent(output);
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error('The staging workdir must be a directory.');
  function inspect(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      rejectLinks(path);
      if (relative === 'supabase' && entry.isDirectory()) {
        inspect(path, relative);
      } else if (entry.isFile() && files.has(relative)) {
        if (readRegularFile(path) !== files.get(relative)) {
          throw new Error('Existing staging artifact was modified; no files were overwritten.');
        }
      } else {
        // Closed allowlist also refuses .env, .temp/project-ref, SQL and forged baselines.
        throw new Error('Unknown artifact in staging workdir; links, secrets and unreviewed baselines are forbidden.');
      }
    }
  }
  inspect(output);
}

export function prepareLocalStaging({ root = repositoryRoot, ...unknownOptions } = {}) {
  if (Object.keys(unknownOptions).length > 0) throw new Error('Unsupported local staging preparation option.');
  rejectLinks(root);
  root = realpathSync(root);
  const output = join(root, '.local-staging');
  const files = expectedFiles(root);
  validateExistingTree(output, files);
  // Complete validation before the first write. Exclusive creation also prevents overwrites in a race.
  mkdirSync(join(output, 'supabase'), { recursive: true });
  for (const [relative, content] of files) {
    const path = join(output, relative);
    rejectLinks(path);
    if (!statIfPresent(path)) writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  validateExistingTree(output, files);
  return { workdir: output, manifest: join(output, 'manifest.json'), applicationReady: false };
}

export function verifyLocalStaging({ root = repositoryRoot, ...unknownOptions } = {}) {
  if (Object.keys(unknownOptions).length > 0) throw new Error('Unsupported local staging verification option.');
  rejectLinks(root);
  root = realpathSync(root);
  const output = join(root, '.local-staging');
  const files = expectedFiles(root);
  validateExistingTree(output, files);
  for (const relative of files.keys()) {
    if (!statIfPresent(join(output, relative))) throw new Error('Local staging preparation is incomplete.');
  }
  return { workdir: output, manifest: join(output, 'manifest.json'), applicationReady: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== '--check')) {
      throw new Error('Only --check is accepted; destination and empty-bootstrap scope are fixed.');
    }
    const result = args.length ? verifyLocalStaging() : prepareLocalStaging();
    console.log(`${args.length ? 'Verified' : 'Prepared'} ${result.workdir}`);
    console.log('Empty infrastructure only. Baseline pending; applicationReady=false; no services started.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
