import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATION_FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const MAX_EXAMPLES = 12;

function normalizedMigration(value, label) {
  if (!value || !/^\d{14}$/.test(String(value.version))) {
    throw new Error(`${label} has an invalid migration version`);
  }
  return { version: String(value.version), name: String(value.name ?? "") };
}

export function analyzeMigrationParity(localFiles, remoteMigrations) {
  const local = localFiles.map((filename) => {
    const match = MIGRATION_FILE.exec(filename);
    if (!match) throw new Error(`Invalid local migration filename: ${filename}`);
    return { version: match[1], name: match[2] };
  }).sort((a, b) => a.version.localeCompare(b.version));
  const remote = remoteMigrations.map((entry) => normalizedMigration(entry, "Remote history"))
    .sort((a, b) => a.version.localeCompare(b.version));
  if (!local.length || !remote.length) throw new Error("Local and remote migration histories are required");

  const localVersions = new Map(local.map((entry) => [entry.version, entry]));
  const remoteVersions = new Map(remote.map((entry) => [entry.version, entry]));
  if (localVersions.size !== local.length || remoteVersions.size !== remote.length) {
    throw new Error("Duplicate migration version in local or remote history");
  }

  // The earliest local migration is the consolidated baseline. Older production
  // versions are intentionally represented by that baseline, not replayed.
  const baselineVersion = local[0].version;
  const latestRemoteVersion = remote.at(-1).version;
  const relevantRemote = remote.filter((entry) => entry.version >= baselineVersion);
  const remoteNames = new Map();
  for (const entry of relevantRemote) {
    if (!entry.name) continue;
    const versions = remoteNames.get(entry.name) ?? [];
    versions.push(entry.version);
    remoteNames.set(entry.name, versions);
  }

  const nameConflicts = local.flatMap((entry) =>
    (remoteNames.get(entry.name) ?? [])
      .filter((remoteVersion) => remoteVersion !== entry.version)
      .map((remoteVersion) => ({ name: entry.name, localVersion: entry.version, remoteVersion })),
  );
  const versionConflicts = local.flatMap((entry) => {
    const applied = remoteVersions.get(entry.version);
    return applied && applied.name && applied.name !== entry.name
      ? [{ version: entry.version, localName: entry.name, remoteName: applied.name }]
      : [];
  });
  const retroactiveLocal = local.filter((entry) =>
    entry.version <= latestRemoteVersion && !remoteVersions.has(entry.version));
  const missingLocal = relevantRemote.filter((entry) => !localVersions.has(entry.version));

  return {
    safe: !nameConflicts.length && !versionConflicts.length
      && !retroactiveLocal.length && !missingLocal.length,
    baselineVersion,
    latestRemoteVersion,
    counts: { local: local.length, remote: remote.length, relevantRemote: relevantRemote.length },
    nameConflicts,
    versionConflicts,
    retroactiveLocal,
    missingLocal,
  };
}

export function formatParityReport(result) {
  const summary = [
    `Supabase migration parity ${result.safe ? "passed" : "BLOCKED"}.`,
    `Local: ${result.counts.local}; remote: ${result.counts.remote}; `
      + `baseline: ${result.baselineVersion}; latest remote: ${result.latestRemoteVersion}.`,
    `Conflicting names/timestamps: ${result.nameConflicts.length}; `
      + `conflicting version/name pairs: ${result.versionConflicts.length}; `
      + `retroactive local migrations: ${result.retroactiveLocal.length}; `
      + `remote migrations missing locally: ${result.missingLocal.length}.`,
  ];
  const examples = [
    ["Name/timestamp conflicts", result.nameConflicts,
      (item) => `${item.name}: local ${item.localVersion}, remote ${item.remoteVersion}`],
    ["Version/name conflicts", result.versionConflicts,
      (item) => `${item.version}: local ${item.localName}, remote ${item.remoteName}`],
    ["Retroactive local migrations", result.retroactiveLocal,
      (item) => `${item.version}_${item.name}`],
    ["Remote migrations missing locally", result.missingLocal,
      (item) => `${item.version}_${item.name}`],
  ];
  for (const [label, items, describe] of examples) {
    if (!items.length) continue;
    summary.push(`${label} (first ${Math.min(items.length, MAX_EXAMPLES)}):`);
    summary.push(...items.slice(0, MAX_EXAMPLES).map((item) => `  ${describe(item)}`));
  }
  if (!result.safe) {
    summary.push("Do not run db push or replay migrations until the version history and SQL effects are reconciled.");
  }
  return summary.join("\n");
}

async function remoteHistoryFromPostgres() {
  if (!process.env.AGVLOG_RELEASE_DB_URL) {
    throw new Error("Set AGVLOG_RELEASE_DB_URL or pass --remote-history <json-file>");
  }
  const query = "select json_build_object('migrations', coalesce(json_agg("
    + "json_build_object('version', version::text, 'name', name) order by version), '[]'::json)) "
    + "from supabase_migrations.schema_migrations";
  const result = spawnSync(process.platform === "win32" ? "psql.exe" : "psql", [
    "--no-psqlrc", "--no-password", "--quiet", "--no-align", "--tuples-only",
    "--set", "ON_ERROR_STOP=1", "--command", query,
  ], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PGDATABASE: process.env.AGVLOG_RELEASE_DB_URL,
      PGOPTIONS: "-c default_transaction_read_only=on",
    },
  });
  if (result.error || result.status !== 0) {
    // Do not print psql stderr: a connection string may be present in diagnostics.
    throw new Error(`Read-only production migration query failed (exit ${result.status ?? "unknown"})`);
  }
  return JSON.parse(result.stdout.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const historyFlag = args.indexOf("--remote-history");
  if (historyFlag >= 0 && (historyFlag !== 0 || args.length !== 2 || !args[1])) {
    throw new Error("Usage: node scripts/check-supabase-migration-parity.mjs [--remote-history <json-file>]");
  }
  if (historyFlag < 0 && args.length) {
    throw new Error("Usage: node scripts/check-supabase-migration-parity.mjs [--remote-history <json-file>]");
  }
  const remoteHistory = historyFlag >= 0
    ? JSON.parse(await readFile(args[1], "utf8"))
    : await remoteHistoryFromPostgres();
  const remote = Array.isArray(remoteHistory) ? remoteHistory : remoteHistory.migrations;
  if (!Array.isArray(remote)) throw new Error("Remote history must contain a migrations array");
  const files = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql"));
  const report = analyzeMigrationParity(files, remote);
  console.log(formatParityReport(report));
  if (!report.safe) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Supabase migration parity check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
