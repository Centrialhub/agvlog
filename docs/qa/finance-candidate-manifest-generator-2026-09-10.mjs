// Read-only repository inventory; writes only the companion QA JSON.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const list = (...args) => git(...args).split('\n').filter(Boolean);
const changed = new Set([...list('diff','--name-only','HEAD'), ...list('ls-files','--others','--exclude-standard')]);
const tracked = new Set(list('ls-files'));
const all = new Set([...tracked, ...changed]);
const hash = p => fs.existsSync(p) && fs.statSync(p).isFile() ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
const src = [...all].filter(p => /^src\/.*\.[cm]?[jt]sx?$/.test(p) && fs.existsSync(p));
const edges = new Map();
function resolve(from, spec) {
  const base = spec.startsWith('@/') ? `src/${spec.slice(2)}` : spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)) : null;
  if (!base) return null;
  return [base, ...['.ts','.tsx','.js','.jsx','/index.ts','/index.tsx'].map(x=>base+x)].find(p=>all.has(p)) ?? null;
}
for (const p of src) {
  const text = fs.readFileSync(p,'utf8');
  const specs = [...text.matchAll(/(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/g)].map(m=>m[1]);
  edges.set(p, [...new Set(specs.map(s=>resolve(p,s)).filter(Boolean))]);
}
const page = /^src\/pages\/(?:Finance\w*|Financial|BankReconciliation|CostCenters|ExpenseApproval|Payroll|Receivables|Payables|DriverSettlements)\.tsx$/;
const hook = /^src\/hooks\/use(?:BankReconciliation|DriverSettlements|ExpenseCreation|ExpenseReview|FinancialPayments|Payables|Payroll|ReceivableFinancial|Receivables)\.[jt]sx?$/;
const direct = new Set(src.filter(p=>/^src\/(?:components|lib)\/financial\//.test(p) || page.test(p) || hook.test(p) || p==='src/lib/bankStatementParser.ts'));
const reached = new Set(direct), queue = [...direct];
while(queue.length) for(const p of edges.get(queue.shift()) ?? []) if(!reached.has(p)){reached.add(p);queue.push(p);}
const financialTest = /(?:finance|financial|receivable|payable|payroll|settlement|expense|statement|reconciliation|recordedCost|unloading|movement|accountPeriod|accountOpening|cashPeriod|cashOpening|periodMoney|periodUnloading|stockAcquisition|stockConsumption|maintenanceLabor|maintenanceDirectPart|legacyCost|legacyCut|legacyInventory|legacyIntegrity|unbilledFreight|fiscalDashboard|transferPeriod|transferStage)/i;
const testRoots = src.filter(p=>p.startsWith('src/test/') && (financialTest.test(path.posix.basename(p)) || (edges.get(p)??[]).some(q=>direct.has(q))));
const testReached = new Set(testRoots), tq=[...testRoots];
while(tq.length) for(const p of edges.get(tq.shift())??[]) if(p.startsWith('src/test/')&&!testReached.has(p)){testReached.add(p);tq.push(p);}
function classify(p){
  if(/^\.codex\//.test(p) || /(?:^|\/)\.env(?:\.|$)/.test(p)) return ['excluded_local_configuration','No contents or hashes collected'];
  if(/^supabase\/migrations\//.test(p)) return /_(?:finance_|reassert_finance_)/.test(p) ? ['finance_migration_candidate','Financial name; requires complete ordered-chain rehearsal, not proof of ownership'] : ['operational_migration_review','Separate owner/dependency review; never automatically include'];
  if(direct.has(p)) return ['finance_runtime_candidate','Financial directory or explicit page/hook root'];
  if(reached.has(p)) return ['shared_runtime_dependency','Reachable by static local import from financial runtime; whole diff not automatically financial'];
  if(testReached.has(p)) return ['finance_test_candidate','Name/direct financial import, plus test-helper import closure; attribution requires review'];
  if(/^supabase\/(?:functions\/.*(?:finance-|financial-|statement-original)|bootstrap\/finance_)/.test(p)) return ['finance_worker_candidate','Financial worker/bootstrap naming; shared adapters reviewed separately'];
  if(/^scripts\/test-(?:finance|receivable-financial)/.test(p)) return ['finance_qa_candidate','Financial native harness; verify referenced suites and helper imports'];
  if(/^docs\/(?:.*\/)?(?:finance|FINANCE|financeiro|planejamento-financeiro)/.test(p)) return ['finance_documentation','Includes proposals/historical evidence, not executable dependencies'];
  if(['package.json','vite.config.ts','tailwind.config.ts','supabase/config.toml','scripts/test-delivery-concurrency.mjs','supabase/functions/secure-upload/index.ts','supabase/functions/_shared/cors.ts','supabase/bootstrap/cron_jobs.sql','src/integrations/supabase/types.ts','e2e/all-routes-smoke.spec.ts','docs/data-contract.md'].includes(p)) return ['shared_hunks_review','Shared configuration or integration; split at hunk/contract level'];
  return ['other_or_unattributed','Outside identified financial roots; do not include without evidence'];
}
const rows=[...changed].sort().map(p=>{
 const [classification,reason]=classify(p);
 return {path:p,status:tracked.has(p) ? 'tracked_changed' : 'untracked',classification,reason,sha256:classification === 'excluded_local_configuration' ? null : hash(p),financial_import_parents:[...edges.entries()].filter(([parent,children])=>reached.has(parent)&&children.includes(p)).map(([parent])=>parent),local_imports:edges.get(p)??[]};
});
const migrations=[...all].filter(p=>p.startsWith('supabase/migrations/')&&p.endsWith('.sql')).sort().map(p=>({path:p,sha256:hash(p),changed:changed.has(p),classification:classify(p)[0]}));
const result={version:1,captured_at:new Date().toISOString(),base_commit:git('rev-parse','HEAD'),description:'Candidate inventory, NOT approved inclusion list or deployment order. Static import reachability does not attribute mixed diffs. No staging/commit/push.',generator:'docs/qa/finance-candidate-manifest-generator-2026-09-10.mjs',finance_runtime_roots:[...direct].sort(),changed_files:rows,migrations,limitations:['SQL ordering/dependency closure not proven; all local migrations listed so omissions remain visible.','Static imports only; dynamic construction, SQL dependencies and Edge Function imports need review.','File names and import reachability are selection evidence, not ownership proof.','Hashes are a working-tree snapshot and must be revalidated before extraction.','Generated manifest excludes its own output to avoid self-referential hashing.']};
const out='docs/qa/finance-candidate-manifest-2026-09-10.json';
result.changed_files=result.changed_files.filter(r=>r.path!==out);
result.counts={};for(const r of result.changed_files)result.counts[r.classification]=(result.counts[r.classification]??0)+1;
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:out,base:result.base_commit,changed:result.changed_files.length,migrations:migrations.length,counts:result.counts},null,2));
