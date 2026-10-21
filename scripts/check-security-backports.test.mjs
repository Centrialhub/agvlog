import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifySecurityBackports} from './check-security-backports.mjs';

function fixture(change){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agvlog-security-backport-'));
 try{
  for(const file of ['package.json','package-lock.json','vendor','supabase/functions/_shared/vendor/forge','supabase/functions/fiscal-certificate-manage/deno.json',
   'node_modules/braces','node_modules/node-forge','node_modules/chokidar','node_modules/micromatch']){
   const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.cpSync(path.resolve(file),target,{recursive:true});
  }
  change(dir);
 }finally{
  assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));
  assert(path.basename(dir).startsWith('agvlog-security-backport-'));
  fs.rmSync(dir,{recursive:true});
 }
}
test('installed, locked, vendored and Edge artifacts match immutable security pins',()=>assert.equal(verifySecurityBackports().installedAndEdgeBytesVerified,true));
test('Git preserves reviewed artifact bytes even with Windows autocrlf enabled',()=>{
 for(const file of ['vendor/node-forge-1.4.1-agvlog.2.provenance.json','vendor/braces-3.0.4-agvlog.1.provenance.json',
  'vendor/node-forge-edge-esm.provenance.json','supabase/functions/_shared/vendor/forge/lib/rsa.js',
  'supabase/functions/_shared/vendor/forge/package.json','supabase/functions/_shared/vendor/forge/edge.mjs']){
  const raw=execFileSync('git',['show','HEAD:'+file]);
  const checkedOut=execFileSync('git',['-c','core.autocrlf=true','cat-file','--filters','HEAD:'+file],{maxBuffer:4*1024*1024});
  assert(raw.equals(checkedOut),'Git converted verified artifact bytes: '+file);
 }
});
test('rejects tampered fiscal RSA code even if the package version is correct',()=>fixture(dir=>{
 fs.appendFileSync(path.join(dir,'supabase/functions/_shared/vendor/forge/lib/rsa.js'),'\n// tampered');
 assert.throws(()=>verifySecurityBackports(dir),/bytes mismatch/);
}));
test('rejects tampered provenance instead of accepting self-approved hashes',()=>fixture(dir=>{
 fs.appendFileSync(path.join(dir,'vendor/braces-3.0.4-agvlog.1.provenance.json'),' ');
 assert.throws(()=>verifySecurityBackports(dir),/bytes mismatch/);
}));
test('rejects reverting the fiscal runtime to the vulnerable registry package',()=>fixture(dir=>{
 const file=path.join(dir,'supabase/functions/fiscal-certificate-manage/deno.json');
 const value=JSON.parse(fs.readFileSync(file));value.imports['node-forge']='npm:node-forge@1.4.0';fs.writeFileSync(file,JSON.stringify(value));
 assert.throws(()=>verifySecurityBackports(dir),/Fiscal Edge/);
}));
test('rejects an extra stale browser bundle even when all pinned source files match',()=>fixture(dir=>{
 const directory=path.join(dir,'node_modules/node-forge/dist');fs.mkdirSync(directory);
 fs.writeFileSync(path.join(directory,'forge.min.js'),'unpatched browser bundle');
 assert.throws(()=>verifySecurityBackports(dir),/inventory/);
}));
