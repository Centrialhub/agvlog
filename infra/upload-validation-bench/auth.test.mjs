import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasBenchmarkToken} from '../../supabase/functions/finance-image-runtime-benchmark/benchmark-auth.ts';
const token='a'.repeat(64);
test('requires a configured strong dedicated token',()=>{
 assert.equal(hasBenchmarkToken(`Bearer ${token}`,undefined),false);
 assert.equal(hasBenchmarkToken('Bearer short','short'),false);
 assert.equal(hasBenchmarkToken(null,token),false);
 assert.equal(hasBenchmarkToken(`Bearer ${token}`,token),true);
});
test('rejects other tokens including user and platform JWTs without fallback',()=>{
 for(const header of ['Bearer user-jwt','Bearer service-role-jwt',`Bearer ${'b'.repeat(64)}`,`bearer ${token}`,`Bearer ${token} `])assert.equal(hasBenchmarkToken(header,token),false);
});