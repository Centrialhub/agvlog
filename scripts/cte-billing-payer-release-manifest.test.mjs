import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectBaselineCandidate} from './check-baseline-candidate.mjs';
import {payerMigration} from './cte-billing-payer-release-manifest.mjs';
test('payer release preserves the frozen baseline and both earlier CT-e releases',async()=>{
 const state=await inspectBaselineCandidate();
 assert.equal(state.candidate.forwards.length+state.followups.forwards.length+state.supplements.forwards.length,46);
 assert.equal(state.payerAddition.filename,payerMigration);
 assert.notEqual(state.payerAddition.filename,state.releaseAddition.filename);
 assert.notEqual(state.payerAddition.filename,state.subcontractingAddition.filename);
});
