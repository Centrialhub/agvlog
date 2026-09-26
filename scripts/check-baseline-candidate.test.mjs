import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  buildBaselineCandidateManifest,
  EXPECTED_FORWARD_FILES,
  verifyBaselineCandidateManifest,
} from "./check-baseline-candidate.mjs";

async function makeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "agvlog-baseline-candidate-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    assert.match(basename(root), /^agvlog-baseline-candidate-/);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "supabase", "migrations"), { recursive: true });
  await mkdir(join(root, "docs", "qa"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { supabase: "2.116.0" } }));
  await Promise.all(EXPECTED_FORWARD_FILES.map((filename) =>
    writeFile(join(root, "supabase", "migrations", filename), `-- fixture ${filename}\nselect 'private-fixture-marker';\n`)));
  const manifest = await buildBaselineCandidateManifest(root);
  await writeFile(join(root, "docs", "qa", "baseline-candidate-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

test("manifest records the historical cutoff and byte hashes without SQL content", async (t) => {
  const root = await makeFixture(t);
  const manifest = await verifyBaselineCandidateManifest(root);
  assert.deepEqual({
    count: manifest.liveObservation.migrationCount,
    cutoff: manifest.liveObservation.maxVersion,
    forwards: manifest.forwards.length,
  }, { count: 896, cutoff: "20260924155758", forwards: 13 });
  const firstSql = await readFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]));
  assert.equal(manifest.forwards[0].sha256, createHash("sha256").update(firstSql).digest("hex"));
  assert.doesNotMatch(JSON.stringify(manifest), /private-fixture-marker/);
  assert.deepEqual(Object.keys(manifest.forwards[0]), ["version", "filename", "sha256"]);
});

test("a changed migration body invalidates the reviewed manifest", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]), "select 2;\n");
  await assert.rejects(verifyBaselineCandidateManifest(root), /differs from repository migrations/);
});

test("an extra future migration blocks candidate preparation", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", "20260927000000_unreviewed_change.sql"), "select 1;\n");
  await assert.rejects(buildBaselineCandidateManifest(root), /Expected exactly 13 candidate forwards/);
});

test("a changed historical ledger checkpoint is rejected", async (t) => {
  const root = await makeFixture(t);
  const path = join(root, "docs", "qa", "baseline-candidate-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.liveObservation.migrationCount = 897;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(verifyBaselineCandidateManifest(root), /differs from repository migrations/);
});

test("an unpinned Supabase CLI blocks candidate preparation", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { supabase: "^2.116.0" } }));
  await assert.rejects(buildBaselineCandidateManifest(root), /must be pinned to an exact version/);
});

test("Windows line endings cannot bless a hash that Git will normalize", async (t) => {
  const root = await makeFixture(t);
  await writeFile(join(root, "supabase", "migrations", EXPECTED_FORWARD_FILES[0]), "select 1;\r\n");
  await assert.rejects(buildBaselineCandidateManifest(root), /must use LF line endings/);
});

test("manifest formatting remains portable on a Windows checkout", async (t) => {
  const root = await makeFixture(t);
  const path = join(root, "docs", "qa", "baseline-candidate-manifest.json");
  const saved = await readFile(path, "utf8");
  await writeFile(path, saved.replace(/\n/g, "\r\n"));
  await verifyBaselineCandidateManifest(root);
});
