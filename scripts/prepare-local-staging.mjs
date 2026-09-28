import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReviewedLocalBaseline } from './local-staging-baseline.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = 'infra/local-staging/config.toml';
const templateSha256 = 'df0703b59d0ecac3d5ef7fd98a3cc20c878a861afc7f84cee349a7ff01b7a021';
export const LOCAL_STAGING_CLI_VERSION = '2.116.0';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
// Studio creates snippets as an empty directory; no child path is allowlisted.
const allowedDirectories = new Set(['supabase', 'supabase/.temp', 'supabase/.branches', 'supabase/snippets']);
const runtimeMetadata = new Map([
  // This is an update notice, not permission to change the pinned CLI version.
  // Stable semver only, optional v, canonical numbers of at most five digits.
  ['supabase/.temp/cli-latest', { minBytes: 5, maxBytes: 18, accepts: (value) => /^v?(?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,4})(?![\s\S])/.test(value) }],
  ['supabase/.branches/_current_branch', { minBytes: 4, maxBytes: 4, accepts: (value) => value === 'main' }],
]);

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

function readRegularFile(path, asBuffer = false) {
  rejectLinks(path);
  if (!lstatSync(path).isFile()) throw new Error('Expected a regular local staging source file.');
  return readFileSync(path, asBuffer ? undefined : 'utf8');
}

function expectedFiles(root, reviewed = null) {
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
  const files = new Map([['supabase/config.toml', config]]);
  if (reviewed) {
    manifest.formatVersion = 2;
    manifest.state = 'reviewed-baseline-prepared';
    manifest.baseline = {
      state: 'reviewed-artifacts-prepared-not-restored', approvalSha256: reviewed.approvedSha256,
      approvalArtifact: 'baseline/approval.json', catalogCompared: false,
      source: reviewed.approval.source,
      artifacts: reviewed.approval.artifacts,
      forwards: reviewed.approval.candidate.forwards,
    };
    manifest.nextRequirements = [
      'The supplied approval digest fixes reviewed artifacts; JSON declarations alone do not establish a review.',
      'No SQL has been executed by this preparation. Confirm isolated runtime identity before any separate restore.',
      'Restore and compare the baseline before applying forwards, seeds, Auth hook or application functions.',
      'A separate restore procedure and catalog/behavior verification remain required; no application flow is approved.',
    ];
    for (const [relative, bytes] of reviewed.files) {
      files.set(relative, bytes);
      manifest.files[relative] = { sha256: sha256(bytes) };
    }
  }
  files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
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
      const baselineDirectory = files.has('baseline/approval.json') && ['baseline', 'baseline/forwards'].includes(relative);
      if ((allowedDirectories.has(relative) || baselineDirectory) && entry.isDirectory()) {
        inspect(path, relative);
      } else if (runtimeMetadata.has(relative)) {
        const rule = runtimeMetadata.get(relative);
        const metadataStat = lstatSync(path);
        if (!metadataStat.isFile() || metadataStat.nlink !== 1) {
          throw new Error('Expected a regular, unlinked local CLI metadata file.');
        }
        // Bound the read before opening; no trimming or rewriting.
        if (metadataStat.size < rule.minBytes || metadataStat.size > rule.maxBytes) {
          throw new Error('Invalid local CLI metadata size.');
        }
        if (!rule.accepts(readRegularFile(path))) throw new Error('Invalid local CLI metadata content.');
      } else if (entry.isFile() && files.has(relative)) {
        const expected = Buffer.from(files.get(relative));
        if (lstatSync(path).size !== expected.length || !readRegularFile(path, true).equals(expected)) {
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

export function prepareLocalStaging({ root = repositoryRoot, baselineManifest, approvedSha256, ...unknownOptions } = {}) {
  if (Object.keys(unknownOptions).length > 0) throw new Error('Unsupported local staging preparation option.');
  rejectLinks(root);
  root = realpathSync(root);
  const output = join(root, '.local-staging');
  const baselineRequested = baselineManifest !== undefined || approvedSha256 !== undefined;
  if (baselineRequested && (typeof baselineManifest !== 'string' || !baselineManifest || typeof approvedSha256 !== 'string' || !approvedSha256)) {
    throw new Error('Baseline preparation requires a private manifest and its external approval hash.');
  }
  const reviewed = baselineRequested ? loadReviewedLocalBaseline({ root, manifestPath: baselineManifest, approvedSha256 }) : null;
  const files = expectedFiles(root, reviewed);
  const manifestPath = join(output, 'manifest.json');
  const emptyManifest = expectedFiles(root).get('manifest.json');
  const manifestStat = statIfPresent(manifestPath);
  if (manifestStat?.size > 256 * 1024) throw new Error('Existing staging manifest exceeds the reviewed size limit.');
  const currentManifest = manifestStat ? readRegularFile(manifestPath) : null;
  const transitioning = reviewed && currentManifest === emptyManifest;
  const currentFiles = new Map(files);
  if (transitioning) currentFiles.set('manifest.json', emptyManifest);
  validateExistingTree(output, currentFiles);
  // Complete validation before the first write. Exclusive creation also prevents overwrites in a race.
  mkdirSync(join(output, 'supabase'), { recursive: true });
  for (const [relative, content] of files) {
    const path = join(output, relative);
    rejectLinks(path);
    mkdirSync(dirname(path), { recursive: true });
    if (!statIfPresent(path)) writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  if (transitioning) {
    // Only the exact validated bootstrap manifest can advance. Config and SQL are never overwritten.
    if (readRegularFile(manifestPath) !== emptyManifest) throw new Error('Staging manifest changed during baseline preparation.');
    const temporary = join(output, `.manifest-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, files.get('manifest.json'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      renameSync(temporary, manifestPath);
    } finally {
      if (statIfPresent(temporary)) unlinkSync(temporary);
    }
  }
  validateExistingTree(output, files);
  return { workdir: output, manifest: manifestPath, applicationReady: false,
    ...(reviewed ? { state: 'reviewed-baseline-prepared', approvalSha256: reviewed.approvedSha256 } : {}) };
}

export function verifyLocalStaging({ root = repositoryRoot, approvedSha256, ...unknownOptions } = {}) {
  if (Object.keys(unknownOptions).length > 0) throw new Error('Unsupported local staging verification option.');
  rejectLinks(root);
  root = realpathSync(root);
  const output = join(root, '.local-staging');
  const reviewed = approvedSha256 === undefined ? null : loadReviewedLocalBaseline({ root,
    manifestPath: join(output, 'baseline/approval.json'), approvedSha256, prepared: true });
  const files = expectedFiles(root, reviewed);
  validateExistingTree(output, files);
  for (const relative of files.keys()) {
    if (!statIfPresent(join(output, relative))) throw new Error('Local staging preparation is incomplete.');
  }
  return { workdir: output, manifest: join(output, 'manifest.json'), applicationReady: false,
    ...(reviewed ? { state: 'reviewed-baseline-prepared', approvalSha256: reviewed.approvedSha256 } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let result;
    let checking = false;
    if (args.length === 0) result = prepareLocalStaging();
    else if (args.length === 1 && args[0] === '--check') {
      checking = true;
      result = verifyLocalStaging();
    } else if (args.length === 3 && args[0] === '--check' && args[1] === '--approved-sha256') {
      checking = true;
      result = verifyLocalStaging({ approvedSha256: args[2] });
    } else if (args.length === 4 && args[0] === '--baseline-manifest' && args[2] === '--approved-sha256') {
      result = prepareLocalStaging({ baselineManifest: args[1], approvedSha256: args[3] });
    } else {
      throw new Error('Only --check is accepted unless explicit reviewed-baseline options are supplied.');
    }
    console.log(`${checking ? 'Verified' : 'Prepared'} ${result.workdir}`);
    console.log(result.state === 'reviewed-baseline-prepared'
      ? 'Reviewed baseline artifacts prepared; not restored; applicationReady=false; no SQL executed or services started.'
      : 'Empty infrastructure only. Baseline pending; applicationReady=false; no services started.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
