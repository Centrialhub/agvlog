import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMigrationParity, formatParityReport } from "./check-supabase-migration-parity.mjs";

const baseline = "20260824224152_baseline.sql";

test("permits a matching applied history and future migrations", () => {
  const result = analyzeMigrationParity([
    baseline,
    "20260924124326_geofence_grant.sql",
    "20260926190000_future_change.sql",
  ], [
    { version: "20260823000000", name: "pre_baseline" },
    { version: "20260824224152", name: "baseline" },
    { version: "20260924124326", name: "geofence_grant" },
  ]);
  assert.equal(result.safe, true);
  assert.equal(result.missingLocal.length, 0);
  assert.equal(result.retroactiveLocal.length, 0);
});

test("blocks replay when an equivalent migration was applied under another version", () => {
  const result = analyzeMigrationParity([
    baseline,
    "20260916152615_finalize_geofence_automation.sql",
    "20260924124326_geofence_grant.sql",
  ], [
    { version: "20260824224152", name: "baseline" },
    { version: "20260916153300", name: "finalize_geofence_automation" },
    { version: "20260924124326", name: "geofence_grant" },
  ]);
  assert.equal(result.safe, false);
  assert.deepEqual(result.nameConflicts, [{
    name: "finalize_geofence_automation",
    localVersion: "20260916152615",
    remoteVersion: "20260916153300",
  }]);
  assert.equal(result.retroactiveLocal[0].version, "20260916152615");
  assert.equal(result.missingLocal[0].version, "20260916153300");
  assert.match(formatParityReport(result), /Do not run db push/);
});

test("blocks an applied version with a different name", () => {
  const result = analyzeMigrationParity([
    baseline,
    "20260924124326_local_change.sql",
  ], [
    { version: "20260824224152", name: "baseline" },
    { version: "20260924124326", name: "remote_change" },
  ]);
  assert.equal(result.safe, false);
  assert.equal(result.versionConflicts.length, 1);
});

test("blocks remote migrations missing from the checkout", () => {
  const result = analyzeMigrationParity([baseline], [
    { version: "20260824224152", name: "baseline" },
    { version: "20260924140531", name: "optimize_tracking_database_work" },
  ]);
  assert.equal(result.safe, false);
  assert.equal(result.missingLocal.length, 1);
});
