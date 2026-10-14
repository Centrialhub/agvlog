import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, parse, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectBaselineCandidate} from './check-baseline-candidate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const selfTransactions = new Map([
  ['20261009151836_address_queue_business_errors_no_serialization_retry.sql', 'ff2183e2e26af28efae7f64d2d8ae184a274ad32ae0d6d05af9975726c51166b'],
  ['20261009161011_address_candidate_business_errors_no_serialization_retry.sql', '27defbe4db4f21d5b97115aa509745bad2f8c86a8ee9dc6fad9367d733b5c3bd'],
]);

export function planForwardTransactions(files, read) {
  const seen = new Set();
  return files.map(({filename, sha256}, index) => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(filename) || seen.has(filename) || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid or duplicate approved forward');
    }
    seen.add(filename);
    const bytes = read(filename);
    if (!Buffer.isBuffer(bytes) || hash(bytes) !== sha256) throw new Error('Approved forward bytes changed');
    const boundaries = bytes.toString('utf8').match(/^\s*(?:begin|commit|rollback)\s*;/gim) ?? [];
    let mode = 'single';
    if (selfTransactions.has(filename)) {
      if (sha256 !== selfTransactions.get(filename) || boundaries.length !== 2 ||
          boundaries[0].trim().toUpperCase() !== 'BEGIN;' || boundaries[1].trim().toUpperCase() !== 'COMMIT;') {
        throw new Error('Reviewed self-transaction forward changed');
      }
      mode = 'self';
    } else if (boundaries.length) {
      throw new Error('Unreviewed transaction boundary in forward');
    }
    return {filename, sha256, bytes, mode, executionFile: `${String(index + 1).padStart(3, '0')}_${filename}`};
  });
}

function rejectLinks(path) {
  const absolute = resolve(path);let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {if (lstatSync(current).isSymbolicLink()) throw new Error('Linked execution path refused');}
    catch (error) {if (error.code === 'ENOENT') break;throw error;}
  }
}

export function writeForwardExecution({repositoryRoot, outputDirectory, plan, contract}) {
  if (!isAbsolute(outputDirectory)) throw new Error('Absolute private output directory required');
  const location = relative(resolve(repositoryRoot), resolve(outputDirectory));
  if (!(location.startsWith(`..${sep}`) || isAbsolute(location))) throw new Error('Execution artifacts must be outside checkout');
  rejectLinks(outputDirectory);
  const parent = lstatSync(dirname(outputDirectory));
  if (!parent.isDirectory() || (process.platform === 'linux' &&
      ((parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid()))) throw new Error('Private owned parent required');
  // Exclusive creation preserves an earlier failure and every original SQL byte.
  mkdirSync(outputDirectory, {mode: 0o700});
  for (const file of plan) writeFileSync(join(outputDirectory, file.executionFile), file.bytes, {mode: 0o600, flag: 'wx'});
  writeFileSync(join(outputDirectory, 'baseline-contract.sql'), contract, {mode: 0o600, flag: 'wx'});
  writeFileSync(join(outputDirectory, 'plan.tsv'), plan.map(file => `${file.mode}\t${file.executionFile}\n`).join(''), {mode: 0o600, flag: 'wx'});
  const result = {formatVersion: 1, purpose: 'exact-approved-forward-execution',
    atomicity: 'one transaction per file; reviewed self-transactions preserved; stop on first failure and preserve committed prefix',
    sqlExecuted: false, forwards: plan.map(({filename, sha256, mode, executionFile}) => ({filename, sha256, mode, executionFile})),
    catalogContractSha256: hash(contract)};
  writeFileSync(join(outputDirectory, 'manifest.json'), JSON.stringify(result, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  return result;
}

export function validateClosedForwardInventory(files) {
  if (files.length !== 42) throw new Error('Expected the closed 42-forward release inventory');
  const last = files.at(-2);
  if (last.version !== '20261014062118' || last.filename !== '20261014062118_native_dispatch_stop_helper_execute.sql' ||
      last.sha256 !== '220233cb4d54a3685290bc6eb2a81c4ddaef34b75ebc52c5337b6727923dd902') {
    throw new Error('Final reviewed stop helper forward changed');
  }
  const policy = files.at(-1);
  if (policy.version !== '20261014141521' || policy.filename !== '20261014141521_remove_required_malware_scan_preserve_receipt_provenance.sql' || policy.sha256 !== 'b6d4967a133a249e67c46fd9e9e6f7c816c0867971cd072bcfbd99ee6dad8613') {
    throw new Error('Reviewed unscanned receipt provenance forward changed');
  }
}

export async function prepareReviewedForwardExecution({repositoryRoot = root, outputDirectory}) {
  const {candidate, followups, supplements} = await inspectBaselineCandidate(repositoryRoot);
  const files = [...candidate.forwards, ...(followups?.forwards ?? []), ...(supplements?.forwards ?? [])];
  validateClosedForwardInventory(files);
  const plan = planForwardTransactions(files, filename => readFileSync(join(repositoryRoot, 'supabase/migrations', filename)));
  return writeForwardExecution({repositoryRoot, outputDirectory, plan, contract: readFileSync(join(repositoryRoot, 'supabase/verify/baseline_contract.sql'))});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--output-directory') throw new Error('Explicit output directory required');
  const result = await prepareReviewedForwardExecution({outputDirectory: process.argv[3]});
  console.log(JSON.stringify({forwardsPrepared: result.forwards.length, sqlExecuted: false, atomicity: result.atomicity}));
}
