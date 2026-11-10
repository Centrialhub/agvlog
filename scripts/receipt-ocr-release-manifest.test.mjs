import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectBaselineCandidate} from './check-baseline-candidate.mjs';
import {receiptOcrMigration} from './receipt-ocr-release-manifest.mjs';
test('receipt OCR is admitted separately while preserving all 46 frozen forwards and CT-e releases',async()=>{
 const state=await inspectBaselineCandidate();
 assert.equal(state.candidate.forwards.length+state.followups.forwards.length+state.supplements.forwards.length,46);
 assert.equal(state.receiptOcrAddition.filename,receiptOcrMigration);
 for(const earlier of [state.releaseAddition,state.subcontractingAddition,state.payerAddition])
  assert.notEqual(earlier.filename,state.receiptOcrAddition.filename);
});
