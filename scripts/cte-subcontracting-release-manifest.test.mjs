import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { inspectBaselineCandidate } from './check-baseline-candidate.mjs';
import { subcontractingMigration, verifyCteSubcontractingRelease } from './cte-subcontracting-release-manifest.mjs';
test('subcontracting release is separate from the preserved 46 forwards and import release',async()=>{
  const state=await inspectBaselineCandidate();
  assert.equal(state.candidate.forwards.length+state.followups.forwards.length+state.supplements.forwards.length,46);
  assert.equal(state.subcontractingAddition.filename,subcontractingMigration);
  assert.notEqual(state.releaseAddition.filename,subcontractingMigration);
});
test('subcontracting manifest rejects changed SQL bytes and changed import manifest',async t=>{
  const root=await mkdtemp(join(tmpdir(),'agv-cte-link-'));
  t.after(async()=>{assert.equal(dirname(root),tmpdir());assert.match(basename(root),/^agv-cte-link-/);await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'docs/qa'),{recursive:true});await mkdir(join(root,'supabase/migrations'),{recursive:true});
  for(const path of ['docs/qa/cte-subcontracting-release-manifest.json','docs/qa/contractor-cte-release-manifest.json',`supabase/migrations/${subcontractingMigration}`]) await writeFile(join(root,path),await readFile(path));
  const verify=async()=>verifyCteSubcontractingRelease({root,forwardFiles:[subcontractingMigration],entries:await readdir(join(root,'supabase/migrations'),{withFileTypes:true})});
  await verify();
  const sqlPath=join(root,'supabase/migrations',subcontractingMigration),sql=await readFile(sqlPath);
  await writeFile(sqlPath,'select 1;\n');await assert.rejects(verify(),/migration bytes changed/);
  await writeFile(sqlPath,sql);await writeFile(join(root,'docs/qa/contractor-cte-release-manifest.json'),'{}');await assert.rejects(verify(),/preserved import manifest changed/);
});
