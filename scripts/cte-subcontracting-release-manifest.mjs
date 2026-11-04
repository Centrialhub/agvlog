import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const subcontractingMigration = '20261103193842_enforce_contractor_cte_issue_link.sql';
const hash = value => createHash('sha256').update(value).digest('hex');
const requireContract = (ok, message) => { if (!ok) throw new Error(`CT-e subcontracting release rejected: ${message}`); };
export async function verifyCteSubcontractingRelease({ root, forwardFiles, entries }) {
  let text;
  try { text = await readFile(resolve(root, 'docs/qa/cte-subcontracting-release-manifest.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const m = JSON.parse(text);
  requireContract(m && Object.keys(m).length === 5 && m.formatVersion === 1 && m.purpose === 'agvlog-cte-subcontracting-only'
    && m.filename === subcontractingMigration && /^[a-f0-9]{64}$/.test(m.sha256 ?? '') && /^[a-f0-9]{64}$/.test(m.preservedImportManifestSha256 ?? ''), 'closed identity required');
  requireContract(forwardFiles.includes(subcontractingMigration) && entries.find(e => e.name === subcontractingMigration)?.isFile(), 'migration missing');
  const preserved = (await readFile(resolve(root, 'docs/qa/contractor-cte-release-manifest.json'), 'utf8')).replace(/\r\n/g, '\n');
  requireContract(hash(preserved) === m.preservedImportManifestSha256, 'preserved import manifest changed');
  const sql = await readFile(resolve(root, 'supabase/migrations', subcontractingMigration));
  requireContract(!sql.includes('\r\n') && hash(sql) === m.sha256, 'migration bytes changed');
  return { filename: subcontractingMigration, sha256: m.sha256 };
}
