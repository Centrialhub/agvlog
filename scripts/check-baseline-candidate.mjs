import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBaselineFollowups } from "./baseline-followup-manifest.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = "docs/qa/baseline-candidate-manifest.json";
const MIGRATIONS_PATH = "supabase/migrations";

// Historical observation, not proof that production is still at this version.
// Reconfirm the live ledger before capturing or applying any database schema.
export const LIVE_OBSERVATION = Object.freeze({
  projectRef: "qcvnsdrbcchaxvawcngk",
  observedDateUtc: "2026-09-26",
  migrationCount: 896,
  maxVersion: "20260924155758",
});

export const EXPECTED_FORWARD_FILES = Object.freeze([
  "20260926183928_restore_portal_list_contracts.sql",
  "20260926184015_restrict_incident_personnel_reads.sql",
  "20260926185847_enforce_fiscal_document_load_tenant.sql",
  "20260926185848_restore_fiscal_freight_rpcs.sql",
  "20260926190513_restore_address_candidate_recording_rpc.sql",
  "20260926190732_restore_inventory_public_rpcs.sql",
  "20260926190733_restore_team_access_public_rpcs.sql",
  "20260926191248_restore_portal_occurrence_command_rpcs.sql",
  "20260926191257_restore_ssx_mapping_conflict_review_rpcs.sql",
  "20260926191456_restore_client_mdfe_documents_v1.sql",
  "20260926191500_restore_delete_load_item_v4.sql",
  "20260926191625_restore_operator_route_reader.sql",
  "20260926191630_restore_productivity_report_reader.sql",
]);

function assertExpectedObservation(observation) {
  if (observation.migrationCount !== 896 || observation.maxVersion !== "20260924155758") {
    throw new Error("Historical production ledger checkpoint changed; reconfirm the live source before preparing a new baseline");
  }
}

function assertExactForwardFiles(actualFiles) {
  const expected = EXPECTED_FORWARD_FILES;
  const missing = expected.filter((file) => !actualFiles.includes(file));
  if (missing.length) {
    throw new Error(`Expected exactly 13 candidate forwards after ${LIVE_OBSERVATION.maxVersion}; `
      + `missing: ${missing.join(", ")}`);
  }
}

async function inspectBaselineCandidate(root) {
  assertExpectedObservation(LIVE_OBSERVATION);
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const supabaseCliVersion = packageJson.devDependencies?.supabase;
  if (!/^\d+\.\d+\.\d+$/.test(supabaseCliVersion ?? "")) {
    throw new Error("Supabase CLI must be pinned to an exact version in package.json");
  }

  const migrationDirectory = resolve(root, MIGRATIONS_PATH);
  const directoryEntries = await readdir(migrationDirectory, { withFileTypes: true });
  const forwardFiles = directoryEntries
    .filter((entry) => entry.name.endsWith(".sql") && /^\d{14}/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name.slice(0, 14) > LIVE_OBSERVATION.maxVersion)
    .sort();
  assertExactForwardFiles(forwardFiles);
  if (directoryEntries.some((entry) => forwardFiles.includes(entry.name) && !entry.isFile())) {
    throw new Error("Candidate forward migration must be a regular file");
  }

  const forwards = await Promise.all(EXPECTED_FORWARD_FILES.map(async (filename) => {
    const sql = await readFile(resolve(migrationDirectory, filename));
    if (sql.includes("\r\n")) {
      throw new Error(`${filename} must use LF line endings before hashing the release artifact`);
    }
    return {
      version: filename.slice(0, 14),
      filename,
      sha256: createHash("sha256").update(sql).digest("hex"),
    };
  }));
  const candidate = {
    formatVersion: 1,
    purpose: "CI-only baseline candidate; no production schema or SQL content",
    liveObservation: LIVE_OBSERVATION,
    requiresFreshLiveLedgerCheck: true,
    supabaseCliVersion,
    forwards,
  };
  const followups = await verifyBaselineFollowups({ root, candidate, forwardFiles, entries: directoryEntries });
  return { candidate, followups };
}

export async function buildBaselineCandidateManifest(root = REPOSITORY_ROOT) {
  return (await inspectBaselineCandidate(root)).candidate;
}

export async function verifyBaselineCandidateManifest(root = REPOSITORY_ROOT) {
  const generated = `${JSON.stringify(await buildBaselineCandidateManifest(root), null, 2)}\n`;
  const saved = await readFile(resolve(root, MANIFEST_PATH), "utf8");
  if (saved.replace(/\r\n/g, "\n") !== generated) {
    throw new Error("Baseline candidate manifest differs from repository migrations or the pinned checkpoint; preserve the reviewed original and investigate the divergence");
  }
  return JSON.parse(saved);
}

export async function runBaselineCandidateCommand(root = REPOSITORY_ROOT, args = []) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) {
    throw new Error("Usage: node scripts/check-baseline-candidate.mjs [--write]");
  }
  const { candidate, followups } = await inspectBaselineCandidate(root);
  const generated = `${JSON.stringify(candidate, null, 2)}\n`;
  let saved;
  try { saved = await readFile(resolve(root, MANIFEST_PATH), "utf8"); }
  catch (error) { if (error.code !== "ENOENT" || args[0] !== "--write") throw error; }
  if (saved !== undefined && saved.replace(/\r\n/g, "\n") !== generated) {
    throw new Error("Baseline candidate manifest differs from repository migrations or the pinned checkpoint; --write cannot replace a reviewed original");
  }
  if (saved === undefined) await writeFile(resolve(root, MANIFEST_PATH), generated, { flag: "wx" });
  return `Baseline candidate manifest passed: ${candidate.forwards.length} original forwards + ${followups?.forwards.length ?? 0} reviewed follow-ups; historical live ledger ${candidate.liveObservation.migrationCount}/${candidate.liveObservation.maxVersion}. Fresh live confirmation and separate application review still required.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBaselineCandidateCommand(REPOSITORY_ROOT, process.argv.slice(2)).then(console.log).catch((error) => {
    console.error(`Baseline candidate check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
