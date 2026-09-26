import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyReleaseEnvironment } from "./check-release-environment.mjs";

const base = {
  repository: "Centrialhub/agvlog",
  defaultBranch: "main",
  ref: "refs/heads/main",
  eventName: "workflow_dispatch",
  token: "test-only-github-token",
};

function mockApi(environment, policies) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return url.includes("deployment-branch-policies") ? policies : environment; },
    };
  };
  return { calls, fetcher };
}

test("allows a manual release on protected branches without requiring a reviewer", async () => {
  const api = mockApi({
    name: "release-candidate",
    protection_rules: [],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  });
  assert.equal(await verifyReleaseEnvironment({ ...base, fetcher: api.fetcher }), "protected branches");
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].url, "https://api.github.com/repos/Centrialhub/agvlog/environments/release-candidate");
  assert.equal(api.calls[0].options.redirect, "error");
  assert.equal(api.calls[0].options.headers.Authorization, `Bearer ${base.token}`);
});

test("allows a custom branch policy only when it names the exact default branch", async () => {
  const environment = {
    name: "release-candidate",
    protection_rules: [],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };
  const api = mockApi(environment, { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] });
  assert.equal(await verifyReleaseEnvironment({ ...base, fetcher: api.fetcher }), "exact main branch");
  assert.equal(api.calls.length, 2);
  for (const policies of [
    { total_count: 1, branch_policies: [{ name: "*", type: "branch" }] },
    { total_count: 2, branch_policies: [{ name: "main" }, { name: "release/*" }] },
    { total_count: 1, branch_policies: [{ name: "main", type: "tag" }] },
  ]) {
    const badApi = mockApi(environment, policies);
    await assert.rejects(verifyReleaseEnvironment({ ...base, fetcher: badApi.fetcher }), /only the exact main branch/);
  }
});

test("fails closed when the environment is auto-created without protections", async () => {
  for (const environment of [
    { name: "release-candidate", protection_rules: [], deployment_branch_policy: null },
    { name: "release-candidate", protection_rules: [],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: false } },
  ]) {
    const api = mockApi(environment);
    await assert.rejects(verifyReleaseEnvironment({ ...base, fetcher: api.fetcher }), /must restrict/);
  }
});

test("checks manual dispatch, workflow source branch and token before API requests", async () => {
  const api = mockApi({});
  await assert.rejects(verifyReleaseEnvironment({ ...base, eventName: "push", fetcher: api.fetcher }), /manual workflow_dispatch/);
  await assert.rejects(verifyReleaseEnvironment({ ...base, ref: "refs/heads/codex/production-stability", fetcher: api.fetcher }), /refs\/heads\/main/);
  await assert.rejects(verifyReleaseEnvironment({ ...base, token: "", fetcher: api.fetcher }), /GITHUB_TOKEN is required/);
  assert.equal(api.calls.length, 0);
});

test("rejects missing or inaccessible environment API response", async () => {
  const fetcher = async () => ({ ok: false, status: 404 });
  await assert.rejects(verifyReleaseEnvironment({ ...base, fetcher }), /HTTP 404/);
});
