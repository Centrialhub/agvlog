import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const environmentName = "release-candidate";

function assertName(value, label) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value ?? "")) throw new Error(`${label} is invalid.`);
  return value;
}

function assertEnvironmentPolicy(environment, policies, defaultBranch) {
  if (environment?.name !== environmentName) {
    throw new Error("The release-candidate GitHub environment is missing.");
  }

  const branchPolicy = environment.deployment_branch_policy;
  if (branchPolicy?.protected_branches === true && branchPolicy.custom_branch_policies === false) {
    return "protected branches";
  }
  if (branchPolicy?.custom_branch_policies !== true || branchPolicy.protected_branches !== false) {
    throw new Error("The release-candidate environment must restrict deployment branches.");
  }
  if (!policies || policies.total_count !== 1 || policies.branch_policies?.length !== 1
    || policies.branch_policies[0]?.name !== defaultBranch
    || (policies.branch_policies[0].type && policies.branch_policies[0].type !== "branch")) {
    throw new Error(`The release-candidate environment must allow only the exact ${defaultBranch} branch.`);
  }
  return `exact ${defaultBranch} branch`;
}

export async function verifyReleaseEnvironment({
  repository, defaultBranch, ref, eventName, token, fetcher = fetch,
}) {
  if (!token) throw new Error("GITHUB_TOKEN is required for the release environment preflight.");
  if (eventName !== "workflow_dispatch") {
    throw new Error("Release verification requires manual workflow_dispatch execution.");
  }
  const [owner, name, extra] = (repository ?? "").split("/");
  assertName(owner, "GitHub repository owner");
  assertName(name, "GitHub repository name");
  if (extra) throw new Error("GitHub repository is invalid.");
  assertName(defaultBranch, "Default branch");
  if (ref !== `refs/heads/${defaultBranch}`) {
    throw new Error(`Release verification must run from refs/heads/${defaultBranch}.`);
  }

  const base = `https://api.github.com/repos/${owner}/${name}/environments/${environmentName}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
  };
  const getJson = async (url) => {
    const response = await fetcher(url, {
      headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub environment policy lookup returned HTTP ${response.status}.`);
    return response.json();
  };

  const environment = await getJson(base);
  const customPolicies = environment?.deployment_branch_policy?.custom_branch_policies === true
    ? await getJson(`${base}/deployment-branch-policies?per_page=100`)
    : undefined;
  return assertEnvironmentPolicy(environment, customPolicies, defaultBranch);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const policy = await verifyReleaseEnvironment({
    repository: process.env.GITHUB_REPOSITORY,
    defaultBranch: process.env.RELEASE_DEFAULT_BRANCH,
    ref: process.env.GITHUB_REF,
    eventName: process.env.GITHUB_EVENT_NAME,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`GitHub release environment verified: manual run from default branch with ${policy}.`);
}
