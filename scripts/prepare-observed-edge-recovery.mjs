import { createHash } from 'node:crypto';
import {
  closeSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const observedManifestPath = join(repositoryRoot, 'docs/qa/edge-reconciliation-2026-09-26.json');
const snapshotDir = join(repositoryRoot, 'docs/qa/edge-source-snapshots-2026-09-26');
const outputRoot = join(repositoryRoot, '.codex-build-audit/edge-observed-recovery-2026-09-26');
const projectRef = 'qcvnsdrbcchaxvawcngk';
const hashNormalization = 'SHA-256 of UTF-8 source after CRLF-to-LF normalization; terminal newline preserved';

const common = {
  'supabase/functions/_shared/active-tenant.ts': '6f027ca3529730d0d15d31544b0084916a284eb13b80731b2042bff377c61a45',
  'supabase/functions/_shared/capabilities.ts': '8c786cc9ae6b031e3a0f2efd2a4f508247b114e1fcbac9b74fa22d1307ddeac3',
  'supabase/functions/_shared/cors.ts': '3f26c39239bb15edba366967581623e1e429f9973b90c97782d94fb2d1546679',
  'supabase/functions/_shared/cron-auth.ts': '26731647b863c8fc1af4a2e4e11d554e14ffe8f07913432c096caae821b19312',
};
const denoJsonSha = 'd8688a8a90af9d0e7a19aa196b5ae98bb362d9e9be1c23ffc7c206f9f5d2f256';
const observed = {
  'agvlog-pipeline-run': {
    functionId: 'c00cb6bf-777f-4524-b30f-af817f77ff5e',
    version: 153,
    updatedAtUtc: '2026-09-24T14:34:28.928Z',
    bundleEzbrSha256: '059dcace57a3ce977482cef9864fb173fe76d7e38ec5e29dd08dc5185ce8ad26',
    files: {
      ...common,
      'supabase/functions/_shared/ssx-sync-checkpoint.ts': 'd943ecadd3b80e5e4617d709b50828834f950ef72e05a0b91db2dd8d10614d44',
      'supabase/functions/agvlog-pipeline-run/index.ts': 'e72258c3434f2fd06b5c9b0d5c0e274087807f442127d420883e3d28101e37c8',
      'supabase/functions/agvlog-pipeline-run/deno.json': denoJsonSha,
    },
  },
  'ssx-sync-governance': {
    functionId: 'abb352b1-74ea-4653-af5a-38cf1650e327',
    version: 14,
    updatedAtUtc: '2026-09-24T14:37:08.502Z',
    bundleEzbrSha256: '90829b3bf6d186e4251ae2354ea19cc78ef9b69ac50af7c0aba999a4f607c560',
    files: {
      ...common,
      'supabase/functions/_shared/ssx-response-diagnostics.ts': '5fa207865b10d0aee7e6ffc2549fda9f722500792bccbed37f13599aa3fb80c6',
      'supabase/functions/_shared/ssx-sync-checkpoint.ts': '05ea002729c606717a076ed20ac496fa1bd256cff8440830550dae84692004b8',
      'supabase/functions/_shared/ssx-utils.ts': '1cf0c99523e75c3856d9da30a1b6cb4216f1e016d53117691b24ca607902430e',
      'supabase/functions/ssx-sync-governance/index.ts': '3384117512f7a4014d6b120464315c594580dcb94ee621e567f881521a78823d',
      'supabase/functions/ssx-sync-governance/snapshot-normalization.ts': '7db46a73bbbeccc7f7b1268fd92841ecbe5befc9c6ab0df82a7e7a3afa2c955b',
      'supabase/functions/ssx-sync-governance/unit-identity.ts': '2f67f2011c1536f58cb2d36c16a4f817fabe6aba67eae92f4367b95db4b10f0a',
      'supabase/functions/ssx-sync-governance/deno.json': denoJsonSha,
    },
  },
  'ssx-sync-units': {
    functionId: '8b6cf270-4924-497c-8305-46080b711fb6',
    version: 146,
    updatedAtUtc: '2026-09-23T17:56:33.147Z',
    bundleEzbrSha256: '436076443f5ac0d44aee9b1fb1e154e57a29e0f237ed731bf25a61e588b14991',
    files: {
      ...common,
      'supabase/functions/_shared/ssx-utils.ts': 'c5af60226dd25720c6af1808484f5d65340a9dfe99856b1f1ffefde7e2bfdd96',
      'supabase/functions/ssx-sync-units/index.ts': '2cd99c4aea6c364023752a6560eca559035bfb9d5fbd8c9242e1110c9b14e615',
      'supabase/functions/ssx-sync-units/deno.json': denoJsonSha,
    },
  },
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function statIfExists(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafePath(target) {
  const fromRoot = relative(repositoryRoot, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Path escapes repository: ${target}`);
  }
  if (statIfExists(repositoryRoot)?.isSymbolicLink()) throw new Error('Repository root is a symlink');
  let current = repositoryRoot;
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (statIfExists(current)?.isSymbolicLink()) throw new Error(`Symlink in path: ${current}`);
  }
}

function listExistingFiles(directory) {
  assertSafePath(directory);
  const stat = statIfExists(directory);
  if (!stat) return [];
  if (!stat.isDirectory()) throw new Error(`Expected directory: ${directory}`);
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertSafePath(path);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in output: ${path}`);
    if (entry.isDirectory()) found.push(...listExistingFiles(path));
    else if (entry.isFile()) found.push(path);
    else throw new Error(`Unsupported output entry: ${path}`);
  }
  return found;
}

function readObservedManifest(slug, pin) {
  assertSafePath(observedManifestPath);
  if (!statIfExists(observedManifestPath)?.isFile()) throw new Error('Observation manifest missing');
  const manifest = JSON.parse(readFileSync(observedManifestPath, 'utf8'));
  const matches = manifest.live_bundles?.filter((bundle) => bundle.slug === slug);
  const live = matches?.[0];
  if (manifest.schema_version !== 1 || manifest.project_ref !== projectRef
      || manifest.hash_normalization !== hashNormalization
      || matches?.length !== 1 || !live
      || live.function_id !== pin.functionId || live.version !== pin.version
      || live.updated_at_utc !== pin.updatedAtUtc
      || live.bundle_ezbr_sha256 !== pin.bundleEzbrSha256
      || live.verify_jwt_live !== false || live.files?.length !== Object.keys(pin.files).length) {
    throw new Error(`Observed bundle identity changed: ${slug}`);
  }
  const seen = new Set();
  for (const file of live.files) {
    if (typeof file.path !== 'string' || !Object.hasOwn(pin.files, file.path)
        || seen.has(file.path)
        || pin.files[file.path] !== file.sha256) {
      throw new Error(`Observed bundle file list changed: ${slug}`);
    }
    seen.add(file.path);
  }
  if (seen.size !== Object.keys(pin.files).length) throw new Error(`Observed bundle incomplete: ${slug}`);
  return live;
}

function verifySnapshots() {
  assertSafePath(snapshotDir);
  if (!statIfExists(snapshotDir)?.isDirectory()) throw new Error('Versioned snapshots missing');
  const expected = new Set(Object.values(observed).flatMap((item) => Object.values(item.files)));
  const actual = readdirSync(snapshotDir, { withFileTypes: true });
  if (actual.length !== expected.size) throw new Error('Versioned snapshot set changed');
  const contents = new Map();
  for (const entry of actual) {
    const match = /^([a-f0-9]{64})\.txt$/.exec(entry.name);
    if (!match || !expected.has(match[1]) || !entry.isFile()) {
      throw new Error(`Unexpected snapshot entry: ${entry.name}`);
    }
    const path = join(snapshotDir, entry.name);
    assertSafePath(path);
    const bytes = readFileSync(path);
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes) || source.includes('\r\n')
        || sha256(bytes) !== match[1]) {
      throw new Error(`Versioned snapshot hash or encoding mismatch: ${entry.name}`);
    }
    contents.set(match[1], source);
  }
  if (contents.size !== expected.size) throw new Error('Versioned snapshots incomplete');
  return contents;
}

function localConfig(slug) {
  return [
    '# Observed source recovery only; target and promotion require separate review.',
    'project_id = "observed-edge-recovery"',
    '',
    `[functions.${slug}]`,
    'verify_jwt = false',
    '',
  ].join('\n');
}

export function prepareObservedEdgeRecovery(slug) {
  if (!Object.hasOwn(observed, slug)) throw new Error(`Unsupported observed bundle: ${slug}`);
  const pin = observed[slug];
  readObservedManifest(slug, pin);
  const snapshots = verifySnapshots();
  const bundleDir = join(outputRoot, slug);
  const entrypointPath = join(bundleDir, 'supabase', 'functions', slug, 'index.ts');
  const manifestPath = join(bundleDir, 'manifest.json');
  const outputs = new Map();
  const files = [];
  for (const [sourcePath, hash] of Object.entries(pin.files)) {
    const snapshotPath = `docs/qa/edge-source-snapshots-2026-09-26/${hash}.txt`;
    const path = sourcePath;
    files.push({ source_path: sourcePath, snapshot_path: snapshotPath, path, sha256: hash });
    outputs.set(join(bundleDir, ...path.split('/')), snapshots.get(hash));
  }
  const config = localConfig(slug);
  outputs.set(join(bundleDir, 'supabase', 'config.toml'), config);
  const outputManifest = {
    schema_version: 1,
    kind: 'local_observed_source_recovery_not_deployed',
    generated_by: 'scripts/prepare-observed-edge-recovery.mjs',
    hash_normalization: hashNormalization,
    source: {
      observation_manifest: 'docs/qa/edge-reconciliation-2026-09-26.json',
      project_ref: projectRef,
      slug,
      function_id: pin.functionId,
      version: pin.version,
      updated_at_utc: pin.updatedAtUtc,
      bundle_ezbr_sha256: pin.bundleEzbrSha256,
      verify_jwt_live: false,
    },
    output: {
      config_path: 'supabase/config.toml',
      config_sha256: sha256(Buffer.from(config, 'utf8')),
      verify_jwt: false,
      files,
    },
  };
  outputs.set(manifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`);

  assertSafePath(bundleDir);
  const expectedPaths = new Set(outputs.keys());
  for (const existing of listExistingFiles(bundleDir)) {
    if (!expectedPaths.has(existing)) throw new Error(`Unexpected recovery output file: ${existing}`);
  }
  for (const [path, source] of outputs) {
    assertSafePath(path);
    const existing = statIfExists(path);
    if (existing && (!existing.isFile() || !readFileSync(path).equals(Buffer.from(source, 'utf8')))) {
      throw new Error(`Recovery output differs; refusing overwrite: ${path}`);
    }
  }
  for (const [path, source] of outputs) {
    if (statIfExists(path)) continue;
    assertSafePath(path);
    mkdirSync(dirname(path), { recursive: true });
    assertSafePath(path);
    const handle = openSync(path, 'wx');
    try { writeFileSync(handle, source, 'utf8'); } finally { closeSync(handle); }
  }
  return { bundleDir, entrypointPath, manifestPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const slugs = process.argv.slice(2);
  if (slugs.length > 1) throw new Error('Pass one allowed slug or no arguments');
  const prepared = (slugs.length ? slugs : Object.keys(observed))
    .map((slug) => prepareObservedEdgeRecovery(slug));
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}
