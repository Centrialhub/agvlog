import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const maxBytes = 500 * 1024;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute) : [absolute];
  }));
  return files.flat();
}

const chunks = await Promise.all(
  (await listFiles(distDir))
    .filter((file) => /\.(?:m?js)$/.test(file))
    .map(async (file) => ({ file, bytes: (await stat(file)).size })),
);

chunks.sort((a, b) => b.bytes - a.bytes);
console.log("Largest JavaScript chunks:");
for (const chunk of chunks.slice(0, 10)) {
  console.log(`${(chunk.bytes / 1024).toFixed(1)} KiB  ${path.relative(distDir, chunk.file)}`);
}

const oversized = chunks.filter((chunk) => chunk.bytes > maxBytes);
if (oversized.length > 0) {
  console.error(`Bundle budget exceeded: ${oversized.length} chunk(s) above 500 KiB.`);
  process.exitCode = 1;
}
