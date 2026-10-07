import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-release-candidate-url.mjs", import.meta.url));
const valid = "https://agvlogistica-btoo2apkz-centrialhubs-projects.vercel.app";

function verify(candidate) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, CANDIDATE_URL: candidate },
  });
}

test("accepts only the project's immutable HTTPS deployment origin", () => {
  assert.equal(verify(valid).status, 0);
  assert.equal(verify(`${valid}/`).status, 0);
});

test("rejects foreign, mutable, and disguised candidate URLs", () => {
  for (const candidate of [
    "https://attacker.example",
    "https://agvlogistica.vercel.app",
    "https://agvlogistica-git-main-centrialhubs-projects.vercel.app",
    "https://agvlogistica-main-centrialhubs-projects.vercel.app",
    "http://agvlogistica-btoo2apkz-centrialhubs-projects.vercel.app",
    `${valid}.attacker.example`,
    `${valid}@attacker.example`,
    `${valid}:8443`,
    `${valid}/auth`,
    `${valid}/?redirect=https://attacker.example`,
    `${valid}/#login`,
    "not a URL",
  ]) {
    const result = verify(candidate);
    assert.notEqual(result.status, 0, `accepted ${candidate}`);
  }
});

test("runs the trusted URL policy before checking out candidate code or injecting the E2E password", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../.github/workflows/release-candidate.yml", import.meta.url)), "utf8");
  const trustedCheckout = workflow.indexOf("- name: Checkout trusted release policy");
  const urlGuard = workflow.indexOf("- name: Verify immutable candidate URL and SHA inputs");
  const environmentGuard = workflow.indexOf("- name: Verify protected release environment before candidate checkout");
  const stagingGuard = workflow.indexOf("- name: Refuse production backend for hosted E2E");
  const candidateCheckout = workflow.indexOf("- name: Checkout candidate commit");
  const hostedE2E = workflow.indexOf("- name: Hosted desktop/tablet/mobile journeys");
  assert.ok(trustedCheckout >= 0 && trustedCheckout < urlGuard && urlGuard < environmentGuard
    && environmentGuard < stagingGuard && stagingGuard < candidateCheckout
    && candidateCheckout < hostedE2E);
  assert.match(workflow.slice(urlGuard, candidateCheckout), /\^\[0-9a-f\]\{40\}\$/);
  assert.equal(workflow.slice(0, hostedE2E).includes("E2E_PASSWORD:"), false);
});
