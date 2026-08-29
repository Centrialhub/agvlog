import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const forbiddenFiles = [];
const findings = [];

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute));
    else result.push(absolute);
  }
  return result;
}

const patterns = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ["service-role JWT", /["']service_role["']\s*[:=]\s*["']eyJ[A-Za-z0-9._-]+/],
  ["public source map reference", /\/\/[#@]\s*sourceMappingURL=/],
];

for (const file of await walk(dist)) {
  const relative = path.relative(dist, file).replaceAll("\\", "/");
  if (/\.map$/i.test(relative) || /(^|\/)\.env(?:\.|$)/i.test(relative)) forbiddenFiles.push(relative);
  if (!/\.(?:html|css|js|mjs|json|txt|xml)$/i.test(relative)) continue;
  if ((await stat(file)).size > 6 * 1024 * 1024) continue;
  const content = await readFile(file, "utf8");
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${relative}: ${label}`);
  }
}

if (forbiddenFiles.length || findings.length) {
  throw new Error([...forbiddenFiles.map((file) => `${file}: forbidden public file`), ...findings].join("\n"));
}
console.log("Public artifact contains no source maps or recognized secret material.");
