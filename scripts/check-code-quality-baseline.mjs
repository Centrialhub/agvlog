import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ESLint } from "eslint";

const baseline = JSON.parse(await readFile("scripts/code-quality-baseline.json", "utf8"));
const eslint = new ESLint();
const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
const explicitAny = results.reduce(
  (total, result) => total + result.messages.filter((message) => message.ruleId === "@typescript-eslint/no-explicit-any").length,
  0,
);
if (explicitAny > baseline.explicitAnyMaximum) {
  throw new Error(`no-explicit-any grew from ${baseline.explicitAnyMaximum} to ${explicitAny}`);
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

const existingLarge = new Set(baseline.existingFilesAbove500);
const newLarge = [];
const criticalGrowth = [];
for (const file of await sourceFiles("src")) {
  const relative = file.replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  const lines = text.trimEnd().split(/\r?\n/).length;
  if (lines > 500 && !existingLarge.has(relative)) newLarge.push(`${relative} (${lines})`);
  const maximum = baseline.criticalMaximumLines[relative];
  if (maximum && lines > maximum) criticalGrowth.push(`${relative}: ${lines} > ${maximum}`);
}

if (newLarge.length) throw new Error(`New files above 500 lines:\n${newLarge.join("\n")}`);
if (criticalGrowth.length) throw new Error(`Critical God components grew:\n${criticalGrowth.join("\n")}`);
console.log(`Code-quality baseline passed: ${explicitAny}/${baseline.explicitAnyMaximum} explicit any warnings; no new >500-line files.`);
