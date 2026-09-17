import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = tracked.filter((file) =>
  /(^|\/)(?:\.env(?:\..+)?|node_modules|dist|coverage|playwright-report|test-results)(?:\/|$)/i.test(file)
  && file !== ".env.example",
);
const forbiddenArtifacts = tracked.filter((file) => /\.log$/i.test(file));
const conflictingPackageManagerFiles = tracked.filter((file) =>
  ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock"].includes(file),
);

const secretPatterns = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];
const secretFindings = [];
for (const file of tracked) {
  if (file === "package-lock.json") continue;
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) secretFindings.push(`${file}: ${label}`);
  }
}

const failures = [
  ...forbiddenPaths.map((file) => `${file}: local/generated path is tracked`),
  ...forbiddenArtifacts.map((file) => `${file}: generated log is tracked`),
  ...conflictingPackageManagerFiles.map((file) => `${file}: npm is the only supported package manager`),
  ...secretFindings,
];
if (failures.length) throw new Error(`Repository hygiene failed:\n${failures.join("\n")}`);

console.log(`Repository hygiene passed for ${tracked.length} tracked files.`);
