import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = '17a7592dca01f31b1aa7b63340fbaf28bb116347';
const slug = 'ssx-sync-rule-violations';
const outputRelative = '.codex-build-audit/edge-compatible-rollback-2026-09-26/ssx-sync-rule-violations-v13';
const sourceManifestPath = join(repositoryRoot, 'docs/qa/edge-reconciliation-2026-09-26.json');
const expectedLiveIdentity = Object.freeze({
  projectRef: 'qcvnsdrbcchaxvawcngk',
  functionId: '056d068e-e4e2-4f60-b1aa-3268afd5d416',
  updatedAtUtc: '2026-09-23T17:56:33.147Z',
  bundleEzbrSha256: '719a48a23c3e6c7ab999c30a87a5336eab4e760d1e0074f5a4158b447ea72cbd',
  hashNormalization: 'SHA-256 of UTF-8 source after CRLF-to-LF normalization; terminal newline preserved',
});
const entrypointSourcePath = `supabase/functions/${slug}/index.ts`;
const sharedHttpSourcePath = 'supabase/functions/_shared/ssx-utils.ts';
const expectedSources = new Set([
  'supabase/functions/_shared/active-tenant.ts',
  'supabase/functions/_shared/capabilities.ts',
  'supabase/functions/_shared/cors.ts',
  'supabase/functions/_shared/cron-auth.ts',
  sharedHttpSourcePath,
  `supabase/functions/${slug}/deno.json`,
  entrypointSourcePath,
]);
const localConfig = [
  '# Compatible rollback bundle only. Select the target project explicitly during a reviewed release.',
  'project_id = "ssx-rule-violations-compatible-rollback"',
  '',
  `[functions.${slug}]`,
  'verify_jwt = false',
  '',
].join('\n');

function sha256Lf(source) {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Pinned v13 anchor missing or ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function lines(...items) { return items.join('\n'); }

function patchEntrypoint(source) {
  let result = replaceOnce(source,
    'const MAX_REQUESTS = 32;\n',
    lines(
      'const MAX_REQUESTS = 32;',
      'const MIN_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60;',
      'const MAX_RATE_LIMIT_BACKOFF_SECONDS = 24 * 60 * 60;',
      '',
      'function rateLimitBackoffSeconds(code: unknown): number {',
      '  if (code === "rate_limited") return MIN_RATE_LIMIT_BACKOFF_SECONDS;',
      '  if (typeof code !== "string") return 0;',
      '  const match = /^rate_limited:(\\d{1,5})$/.exec(code);',
      '  if (!match) return 0;',
      '  return Math.max(MIN_RATE_LIMIT_BACKOFF_SECONDS,',
      '    Math.min(MAX_RATE_LIMIT_BACKOFF_SECONDS, Number(match[1])));',
      '}',
      '',
    ), 'backoff reader');

  result = replaceOnce(result,
    lines(
      '    const { data: violationCursor } = await admin',
      '      .from("ssx_rule_violation_cursors")',
      '      .select("last_error_code,updated_at")',
      '      .eq("integration_account_id", accountId)',
      '      .maybeSingle();',
      '    const cursorUpdatedAt = violationCursor?.updated_at',
      '      ? new Date(violationCursor.updated_at).getTime()',
      '      : 0;',
      '    if (',
      '      violationCursor?.last_error_code === "rate_limited"',
      '      && cursorUpdatedAt > Date.now() - 15 * 60_000',
      '    ) {',
      '      return jsonResp({',
      '        success: true,',
      '        status: "deferred",',
      '        reason: "rate_limited_backoff",',
      '        retry_at: new Date(cursorUpdatedAt + 15 * 60_000).toISOString(),',
    ),
    lines(
      '    const { data: violationCursor, error: cursorReadError } = await admin',
      '      .from("ssx_rule_violation_cursors")',
      '      .select("last_error_code,updated_at")',
      '      .eq("integration_account_id", accountId)',
      '      .maybeSingle();',
      '    if (cursorReadError) throw new Error("cursor_read_failed");',
      '    const cursorUpdatedAt = violationCursor?.updated_at',
      '      ? new Date(violationCursor.updated_at).getTime()',
      '      : 0;',
      '    const backoffSeconds = rateLimitBackoffSeconds(violationCursor?.last_error_code);',
      '    if (',
      '      backoffSeconds > 0',
      '      && cursorUpdatedAt + backoffSeconds * 1000 > Date.now()',
      '    ) {',
      '      return jsonResp({',
      '        success: true,',
      '        status: "deferred",',
      '        reason: "rate_limited_backoff",',
      '        retry_at: new Date(cursorUpdatedAt + backoffSeconds * 1000).toISOString(),',
    ), 'cursor read and cooldown');

  result = replaceOnce(result,
    '          errorClass: response.ok ? undefined : response.errorClass,',
    lines('          errorClass: response.ok ? undefined',
      '            : response.status === 429 ? "rate_limited" : response.errorClass,'),
    '429 diagnostic');

  result = replaceOnce(result,
    '      if (!response.ok) throw new Error(response.errorClass || "upstream_failed");',
    lines(
      '      if (!response.ok) {',
      '        if (response.status === 429 || response.errorClass === "rate_limited") {',
      '          // The pinned HTTP helper is patched below to expose Retry-After.',
      '          const providerSeconds = Math.ceil(response.retryAfterSeconds || 0);',
      '          const effectiveSeconds = Math.max(MIN_RATE_LIMIT_BACKOFF_SECONDS,',
      '            Math.min(MAX_RATE_LIMIT_BACKOFF_SECONDS, providerSeconds));',
      '          throw new Error(effectiveSeconds > MIN_RATE_LIMIT_BACKOFF_SECONDS',
      '            ? `rate_limited:${effectiveSeconds}` : "rate_limited");',
      '        }',
      '        throw new Error(response.errorClass || "upstream_failed");',
      '      }',
    ), '429 writer');
  return result;
}

function patchSharedHttp(source) {
  let result = replaceOnce(source,
    lines('export interface SsxHttpResult {', '  ok: boolean;', '  status: number;',
      '  text: string;', '  parsed: any;', '  parseError: boolean;',
      '  networkError: string | null;', '  durationMs: number;',
      '  errorClass: SsxErrorClass;', '}'),
    lines('export interface SsxHttpResult {', '  ok: boolean;', '  status: number;',
      '  text: string;', '  parsed: any;', '  parseError: boolean;',
      '  networkError: string | null;', '  durationMs: number;',
      '  errorClass: SsxErrorClass;', '  retryAfterSeconds?: number;', '}'),
    'HTTP result type');

  result = replaceOnce(result,
    lines('  const start = Date.now();', '  try {',
      '    const controller = new AbortController();',
      '    const timer = setTimeout(() => controller.abort(), timeoutMs);'),
    lines('  const start = Date.now();',
      '  const controller = new AbortController();',
      '  const timer = setTimeout(() => controller.abort(), timeoutMs);',
      '  let observedStatus = 0;',
      '  let retryAfterSeconds = 0;',
      '  try {'), 'timeout scope');
  result = replaceOnce(result,
    lines('    const resp = await fetch(endpoint, init);',
      '    clearTimeout(timer);', '    const text = await resp.text();'),
    lines('    const resp = await fetch(endpoint, init);',
      '    observedStatus = resp.status;',
      '    const retryHeader = resp.headers.get("Retry-After");',
      '    const retrySeconds = retryHeader === null ? 0 : /^\\d+$/.test(retryHeader)',
      '      ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000);',
      '    retryAfterSeconds = Number.isFinite(retrySeconds) ? Math.min(86400, Math.max(0, retrySeconds)) : 0;',
      '    const text = await resp.text();',
      '    clearTimeout(timer);'), 'response status and header before body');
  result = replaceOnce(result,
    lines('    const errorClass = resp.ok ? (parseError ? "parse_error" : "unknown") : classifyError(resp.status, undefined, parseError);',
      '    return { ok: resp.ok, status: resp.status, text, parsed, parseError, networkError: null, durationMs, errorClass };'),
    lines('    const errorClass = resp.ok ? (parseError ? "parse_error" : "unknown") : classifyError(resp.status, undefined, parseError);',
      '    return { ok: resp.ok, status: resp.status, text, parsed, parseError, networkError: null, durationMs, errorClass, retryAfterSeconds };'),
    'Retry-After return');
  result = replaceOnce(result,
    lines('    return { ok: false, status: 0, text: "", parsed: null, parseError: false, networkError: msg, durationMs, errorClass: classifyError(0, msg) };',
      '  }', '}', '', '// ======================== Body Candidates ========================'),
    lines('    if (observedStatus === 429) {',
      '      return { ok: false, status: 429, text: "", parsed: null, parseError: false,',
      '        networkError: msg, durationMs, errorClass: "rate_limited", retryAfterSeconds };',
      '    }',
      '    return { ok: false, status: 0, text: "", parsed: null, parseError: false, networkError: msg, durationMs, errorClass: classifyError(0, msg) };',
      '  } finally {', '    clearTimeout(timer);', '  }', '}', '', '// ======================== Body Candidates ========================'),
    'timeout cleanup');
  return result;
}

function assertWithin(base, target) {
  const pathFromBase = relative(base, target);
  if (pathFromBase === '..' || pathFromBase.startsWith(`..${sep}`) || isAbsolute(pathFromBase)) {
    throw new Error(`Output path escapes repository: ${target}`);
  }
}

function lstatIfExists(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafePath(target) {
  assertWithin(repositoryRoot, target);
  let current = repositoryRoot;
  for (const segment of relative(repositoryRoot, target).split(sep)) {
    current = join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Symlink in rollback output path: ${current}`);
  }
}

function listExistingFiles(directory) {
  const stat = lstatIfExists(directory);
  if (!stat) return [];
  assertSafePath(directory);
  if (!stat.isDirectory()) throw new Error(`Rollback output directory is not a directory: ${directory}`);
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const item = join(directory, entry.name);
    assertSafePath(item);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in rollback bundle: ${item}`);
    if (entry.isDirectory()) found.push(...listExistingFiles(item));
    else if (entry.isFile()) found.push(item);
    else throw new Error(`Unsupported rollback output entry: ${item}`);
  }
  return found;
}

function pinnedBundle() {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  const live = manifest.live_bundles?.find((item) => item.slug === slug);
  if (manifest.project_ref !== expectedLiveIdentity.projectRef
      || manifest.hash_normalization !== expectedLiveIdentity.hashNormalization
      || manifest.live_bundles?.filter((item) => item.slug === slug).length !== 1
      || !live || live.version !== 13 || live.verified_source_commit !== sourceCommit
      || live.function_id !== expectedLiveIdentity.functionId
      || live.updated_at_utc !== expectedLiveIdentity.updatedAtUtc
      || live.bundle_ezbr_sha256 !== expectedLiveIdentity.bundleEzbrSha256
      || live.verify_jwt_live !== false || live.files?.length !== expectedSources.size) {
    throw new Error('Pinned v13 reconciliation metadata missing or changed');
  }
  const listed = new Set(live.files.map((file) => file.path));
  if (listed.size !== expectedSources.size
      || [...expectedSources].some((path) => !listed.has(path))) {
    throw new Error('Pinned v13 bundle file list changed');
  }
  const objectType = execFileSync('git', ['cat-file', '-t', sourceCommit], {
    cwd: repositoryRoot, encoding: 'utf8', windowsHide: true,
  }).trim();
  if (objectType !== 'commit') throw new Error('Pinned v13 Git object is not a commit');

  const files = live.files.map((file) => {
    const bytes = execFileSync('git', ['show', `${sourceCommit}:${file.path}`], {
      cwd: repositoryRoot, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    const source = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const hash = sha256Lf(source);
    if (hash !== file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Pinned v13 source hash mismatch: ${file.path}`);
    }
    const output = file.path === entrypointSourcePath ? patchEntrypoint(source)
      : file.path === sharedHttpSourcePath ? patchSharedHttp(source) : source;
    return {
      sourcePath: file.path,
      outputPath: file.path,
      sourceSha256: file.sha256,
      outputSha256: sha256Lf(output),
      output,
      changed: output !== source,
    };
  });
  return { manifest, live, files };
}

export function prepareSsxViolationsRollback() {
  const { manifest: sourceManifest, live, files } = pinnedBundle();
  const bundleDir = resolve(repositoryRoot, outputRelative);
  const manifestPath = join(bundleDir, 'manifest.json');
  const entrypointPath = join(bundleDir, entrypointSourcePath);
  const outputs = new Map(files.map((file) => [join(bundleDir, file.outputPath), file.output]));
  outputs.set(join(bundleDir, 'supabase/config.toml'), localConfig);
  const outputManifest = {
    schema_version: 1,
    kind: 'local_compatible_rollback_candidate_not_deployed',
    generated_by: 'scripts/prepare-ssx-violations-rollback.mjs',
    hash_normalization: sourceManifest.hash_normalization,
    source: {
      project_ref: sourceManifest.project_ref,
      slug,
      function_id: live.function_id,
      version: live.version,
      updated_at_utc: live.updated_at_utc,
      bundle_ezbr_sha256: live.bundle_ezbr_sha256,
      pinned_commit: sourceCommit,
      verify_jwt_live: live.verify_jwt_live,
    },
    output: {
      verify_jwt: false,
      backoff_min_seconds: 900,
      backoff_max_seconds: 86400,
      config_path: 'supabase/config.toml',
      config_sha256: sha256Lf(localConfig),
      files: files.map(({ sourcePath, outputPath, sourceSha256, outputSha256, changed }) => ({
        source_path: sourcePath, path: outputPath,
        source_sha256: sourceSha256, sha256: outputSha256, changed,
      })),
      differences_from_v13: [
        'Read legacy rate_limited and extended rate_limited:<seconds> cooldowns.',
        'Fail closed when the cursor read fails.',
        'Record Retry-After >15 minutes up to 24 hours on new HTTP 429 responses, including non-JSON bodies.',
        'Preserve known HTTP 429 status and Retry-After when response body reading fails or times out.',
        'Keep the HTTP timeout active until the response body completes and clear it in finally.',
      ],
    },
  };
  outputs.set(manifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`);

  assertSafePath(bundleDir);
  const expectedPaths = new Set(outputs.keys());
  for (const existing of listExistingFiles(bundleDir)) {
    if (!expectedPaths.has(existing)) throw new Error(`Unexpected rollback output file: ${existing}`);
  }
  for (const [path, source] of outputs) {
    assertSafePath(path);
    const existing = lstatIfExists(path);
    if (existing && (!existing.isFile() || readFileSync(path, 'utf8') !== source)) {
      throw new Error(`Rollback output differs; refusing overwrite: ${path}`);
    }
  }
  for (const [path, source] of outputs) {
    if (lstatIfExists(path)) continue;
    assertSafePath(path);
    mkdirSync(dirname(path), { recursive: true });
    assertSafePath(path);
    const handle = openSync(path, 'wx');
    try { writeFileSync(handle, source, 'utf8'); } finally { closeSync(handle); }
  }
  return { bundleDir, entrypointPath, manifestPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prepared = prepareSsxViolationsRollback();
  const manifest = JSON.parse(readFileSync(prepared.manifestPath, 'utf8'));
  process.stdout.write(JSON.stringify({
    bundleDir: prepared.bundleDir,
    entrypointPath: prepared.entrypointPath,
    manifestPath: prepared.manifestPath,
    sourceCommit: manifest.source.pinned_commit,
    changedFiles: manifest.output.files.filter((file) => file.changed).map((file) => ({
      path: file.path, sha256: file.sha256,
    })),
  }, null, 2) + '\n');
}
