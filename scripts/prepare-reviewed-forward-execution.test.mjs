import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {planForwardTransactions, writeForwardExecution, validateClosedForwardInventory} from './prepare-reviewed-forward-execution.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => readFileSync(join('supabase/migrations', name));
const address = ['20261009151836_address_queue_business_errors_no_serialization_retry.sql', '20261009161011_address_candidate_business_errors_no_serialization_retry.sql'];
const files = address.map(filename => ({filename, sha256: hash(read(filename))}));

test('preserves the two exact reviewed address transactions and their original SQL bytes', () => {
  const plan = planForwardTransactions(files, read);
  assert.deepEqual(plan.map(p => p.mode), ['self', 'self']);
  for (const item of plan) assert.deepEqual(item.bytes, read(item.filename));
});
test('rejects both changed input hashes and an unreviewed transaction before execution', () => {
  assert.throws(() => planForwardTransactions([{...files[0],sha256:'0'.repeat(64)}], read), /bytes changed/);
  const bytes = Buffer.from('BEGIN;\nSELECT 1;\nCOMMIT;\n');
  assert.throws(() => planForwardTransactions([{filename:'20261014000000_unreviewed.sql',sha256:hash(bytes)}], () => bytes), /Unreviewed transaction boundary/);
  const changed = Buffer.concat([read(address[0]), Buffer.from('-- unreviewed delta\n')]);
  assert.throws(() => planForwardTransactions([{filename:address[0],sha256:hash(changed)}], () => changed), /self-transaction forward changed/);
});
test('refuses duplicate or path-injected filenames and classifies ordinary forwards for one transaction', () => {
  assert.throws(() => planForwardTransactions([files[0],files[0]], read), /duplicate/);
  assert.throws(() => planForwardTransactions([{filename:'../bad.sql',sha256:'0'.repeat(64)}], read), /Invalid/);
  const bytes = Buffer.from('SELECT 1;\n');
  assert.equal(planForwardTransactions([{filename:'20261014000000_reviewed.sql',sha256:hash(bytes)}], () => bytes)[0].mode, 'single');
});
test('writes a byte-identical private execution package and refuses overwriting prior evidence', () => {
  const own = mkdtempSync(join(tmpdir(),'agvlog-forward-execution-'));
  try {
    const plan = planForwardTransactions(files, read);const outputDirectory = join(own,'execution');
    const result = writeForwardExecution({repositoryRoot:process.cwd(),outputDirectory,plan,contract:Buffer.from('SELECT 1;\n')});
    assert.equal(result.sqlExecuted,false);
    for (const item of plan) assert.deepEqual(readFileSync(join(outputDirectory,item.executionFile)),item.bytes);
    const before = readdirSync(outputDirectory).sort();
    assert.throws(() => writeForwardExecution({repositoryRoot:process.cwd(),outputDirectory,plan,contract:Buffer.from('bad')}), /EEXIST/);
    assert.deepEqual(readdirSync(outputDirectory).sort(),before);
  } finally {rmSync(own,{recursive:true});}
});

test('qualifies all 42 exact forwards without SQL execution and preserves both reviewed self transactions', () => {
  const inventory = ['baseline-candidate-manifest.json', 'baseline-followup-manifest.json', 'baseline-supplement-manifest.json']
    .flatMap(name => JSON.parse(readFileSync(join('docs/qa', name), 'utf8')).forwards);
  validateClosedForwardInventory(inventory);
  const plan = planForwardTransactions(inventory, read);
  assert.equal(plan.length, 42);
  assert.equal(plan.filter(item => item.mode === 'self').length, 2);
  assert.equal(plan.filter(item => item.mode === 'single').length, 40);
  assert.deepEqual(plan.at(-1).bytes, read('20261014141521_remove_required_malware_scan_preserve_receipt_provenance.sql'));
  assert.throws(() => validateClosedForwardInventory(inventory.slice(0, 41)), /closed 42-forward/);
  assert.throws(() => validateClosedForwardInventory([...inventory, inventory.at(-1)]), /closed 42-forward/);
  assert.throws(() => validateClosedForwardInventory([...inventory.slice(0, -1), {...inventory.at(-1), sha256:'0'.repeat(64)}]), /provenance forward changed/);
  assert.throws(() => validateClosedForwardInventory([...inventory.slice(0,-2), {...inventory.at(-2),sha256:'0'.repeat(64)}, inventory.at(-1)]), /helper forward changed/);
  assert.throws(() => planForwardTransactions(inventory, name => {if (name === inventory.at(-1).filename) throw new Error('missing reviewed file');return read(name);}), /missing reviewed file/);
});
