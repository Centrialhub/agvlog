import { access, readFile } from "node:fs/promises";

const forbidden = ["bun.lockb", "bun.lock", "yarn.lock", "pnpm-lock.yaml"];
const present = [];
for (const path of forbidden) {
  try {
    await access(path);
    present.push(path);
  } catch {
    // Expected: npm is the only package manager for this release.
  }
}
if (present.length) throw new Error(`Conflicting lockfiles: ${present.join(", ")}`);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (packageJson.packageManager !== "npm@10.9.4") throw new Error("packageManager must remain npm@10.9.4");
if (lock.lockfileVersion !== 3) throw new Error("package-lock.json must use lockfileVersion 3");
if (lock.packages?.[""]?.version !== packageJson.version) throw new Error("Root lock metadata is out of sync");

for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, range] of Object.entries(packageJson[section] ?? {})) {
    if (lock.packages?.[""]?.[section]?.[name] !== range) {
      throw new Error(`package-lock root entry differs for ${name}`);
    }
  }
}

console.log("npm lockfile contract is consistent.");
