import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const contractorCteMigration = '20261103174106_import_contractor_cte_sources.sql';
const manifestPath = 'docs/qa/contractor-cte-release-manifest.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireContract = (condition, message) => { if (!condition) throw new Error(`Contractor CT-e release rejected: ${message}`); };

/** Separate release after the preserved 46-forward baseline; never part of its restore plan. */
export async function verifyContractorCteRelease({ root, forwardFiles, entries }) {
  let text;
  try { text = await readFile(resolve(root, manifestPath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const manifest = JSON.parse(text);
  requireContract(manifest && Object.keys(manifest).length === 5 && manifest.formatVersion === 1
    && manifest.purpose === 'agvlog-contractor-cte-import-only'
    && manifest.filename === contractorCteMigration && /^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')
    && /^[a-f0-9]{64}$/.test(manifest.preservedSupplementSha256 ?? ''), 'closed identity required');
  requireContract(forwardFiles.includes(contractorCteMigration)
    && entries.find(entry => entry.name === contractorCteMigration)?.isFile(), 'migration missing or not a regular file');
  const preserved = (await readFile(resolve(root, 'docs/qa/baseline-supplement-manifest.json'), 'utf8')).replace(/\r\n/g, '\n');
  requireContract(hash(preserved) === manifest.preservedSupplementSha256, 'preserved supplement changed');
  const sql = await readFile(resolve(root, 'supabase/migrations', contractorCteMigration));
  requireContract(!sql.includes('\r\n') && hash(sql) === manifest.sha256, 'migration bytes changed');
  return { filename: contractorCteMigration, sha256: manifest.sha256 };
}
