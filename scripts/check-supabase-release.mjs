import { readdir, readFile } from "node:fs/promises";

const migrations = (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const invalidMigrationNames = migrations.filter(
  (name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name),
);
const versions = migrations.map((name) => name.slice(0, 14));
const duplicateVersions = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))];
if (invalidMigrationNames.length || duplicateVersions.length) {
  throw new Error([
    ...invalidMigrationNames.map((name) => `${name}: invalid migration filename`),
    ...duplicateVersions.map((version) => `${version}: duplicate migration version`),
  ].join("\n"));
}

const functionDirectories = (await readdir("supabase/functions", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
  .map((entry) => entry.name)
  .sort();
const config = await readFile("supabase/config.toml", "utf8");
const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]\s*\r?\nverify_jwt\s*=\s*(?:true|false)\s*$/gm)]
  .map((match) => match[1])
  .sort();
const directoryOnly = functionDirectories.filter((name) => !configuredFunctions.includes(name));
const configOnly = configuredFunctions.filter((name) => !functionDirectories.includes(name));
if (directoryOnly.length || configOnly.length) {
  throw new Error([
    ...directoryOnly.map((name) => `${name}: Edge Function is missing an explicit verify_jwt policy`),
    ...configOnly.map((name) => `${name}: config.toml entry has no Edge Function directory`),
  ].join("\n"));
}

console.log(
  `Supabase release contract passed: ${migrations.length} ordered migrations, `
  + `${functionDirectories.length} Edge Functions. Release order is migrations -> verification -> Edge -> frontend -> smoke.`,
);
