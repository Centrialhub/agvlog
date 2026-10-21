import assert from 'node:assert/strict';
import test from 'node:test';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {assertLocalPostgisTarget,verifyPostgisPackage} from './apply-reviewed-postgis-compatibility.mjs';

const valid=()=>({
 database:{name:'/supabase_db_agvlog-local-staging',project:'agvlog-local-staging',running:true,network:'agvlog-local-staging-loopback',ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55322'}]}},
 network:{Name:'agvlog-local-staging-loopback',Driver:'bridge',Options:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'},Containers:Object.fromEntries(Array.from({length:9},(_,i)=>[String(i),{}]))},
 inventory:{public_tables:327,users:7,fixture_tenants:2,active_jobs:0,secret_values:0,pending_http:0,server_version:170006}
});

test('platform package binds exact SQL, provenance and six existing owner-operated APIs',()=>{
 const result=verifyPostgisPackage();assert.equal(result.functions.length,6);
 assert.ok(result.functions.every(f=>f.signature.startsWith('extensions.')&&f.owner==='supabase_admin'&&f.beforeBodyMd5!==f.afterBodyMd5));
 assertLocalPostgisTarget(valid());
});

test('rejects another database, external bindings, a shared network and non-synthetic state',()=>{
 for(const change of [
  x=>{x.database.name='/supabase_db_production';},
  x=>{x.database.ports['5432/tcp'][0].HostIp='0.0.0.0';},
  x=>{x.network.Containers.other={};},
  x=>{x.inventory.users=8;},
  x=>{x.inventory.fixture_tenants=1;},
  x=>{x.inventory.active_jobs=1;},
  x=>{x.inventory.secret_values=1;},
  x=>{x.inventory.pending_http=1;}
 ]){const input=valid();change(input);assert.throws(()=>assertLocalPostgisTarget(input),/postgis_/);}
});

test('altered SQL or provenance is rejected before any database operation',()=>{
 const own=mkdtempSync(join(tmpdir(),'agvlog-postgis-package-'));
 const directory=join(own,'supabase/platform');mkdirSync(directory,{recursive:true});
 const sql='postgis_3_3_7_sql_compatibility.sql',provenance='postgis_3_3_7_sql_compatibility.provenance.json';
 try{
  for(const name of [sql,provenance])copyFileSync(join('supabase/platform',name),join(directory,name));
  verifyPostgisPackage(own);
  writeFileSync(join(directory,sql),Buffer.concat([readFileSync(join(directory,sql)),Buffer.from('-- unreviewed change\n')]));
  assert.throws(()=>verifyPostgisPackage(own),/postgis_package_hash_changed/);
  copyFileSync(join('supabase/platform',sql),join(directory,sql));
  const altered=JSON.parse(readFileSync(join(directory,provenance),'utf8'));altered.functions[0].owner='postgres';
  writeFileSync(join(directory,provenance),JSON.stringify(altered));
  assert.throws(()=>verifyPostgisPackage(own),/postgis_provenance_hash_changed/);
 }finally{
  assert.ok(resolve(own).startsWith(resolve(tmpdir())+sep)&&own.includes('agvlog-postgis-package-'));
  rmSync(own,{recursive:true});
 }
});
