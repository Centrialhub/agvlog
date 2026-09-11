import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
// Strict whole-repository rehearsal. No fixture bootstrap, SQL rewriting or cap.
export async function runFullMigrationSequenceNative({query,literal:q}) {
 const root='supabase/migrations',files=readdirSync(root).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
 const allSql=readdirSync(root).filter(f=>f.endsWith('.sql'));assert.equal(files.length,allSql.length,'An SQL file was excluded from the manifest');
 const versions=files.map(f=>f.split('_')[0]);assert.equal(new Set(versions).size,versions.length,'Duplicate migration version');
 const snapshot=files.map(file=>({file,sql:readFileSync(root+'/'+file,'utf8')}));
 const manifest={version:1,created_at:new Date().toISOString(),scope:'all_repository_migrations',database:'finance_full_sequence_qa',remote_access:false,sql_rewritten:false,complete:false,applied_count:0,total_count:files.length,sequence_sha256:createHash('sha256').update(snapshot.map(x=>x.file+':'+createHash('sha256').update(x.sql).digest('hex')).join('\n')).digest('hex'),preflight:null,migrations:snapshot.map(x=>({file:x.file,sha256:createHash('sha256').update(x.sql).digest('hex'),bytes:Buffer.byteLength(x.sql),status:'not_attempted'}))};
 const save=()=>writeFileSync('docs/qa/finance-full-migration-sequence-manifest-2026-09-10.json',JSON.stringify(manifest,null,2)+'\n');save();
 await query('create database finance_full_sequence_qa');const run=sql=>query(sql,manifest.database);
 const extensions=[...new Set(snapshot.flatMap(x=>[...x.sql.matchAll(/CREATE EXTENSION IF NOT EXISTS\s+(?:"([^"]+)"|([a-z_]+))/gi)].map(m=>m[1]||m[2])))];
 const available=JSON.parse(await run("select coalesce(json_agg(name),'[]'::json) from pg_available_extensions"));
 const platform=JSON.parse(await run(`select jsonb_build_object('auth_users',to_regclass('auth.users') is not null,'auth_uid',to_regprocedure('auth.uid()') is not null,'storage_objects',to_regclass('storage.objects') is not null,'storage_buckets',to_regclass('storage.buckets') is not null,'anon_role',exists(select 1 from pg_roles where rolname='anon'),'authenticated_role',exists(select 1 from pg_roles where rolname='authenticated'),'service_role',exists(select 1 from pg_roles where rolname='service_role'))`));
 manifest.preflight={server_version:await run('show server_version'),required_extensions:extensions,missing_extensions:extensions.filter(e=>!available.includes(e)),platform,public_relations:Number(await run("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p','v','m')"))};save();
 if(manifest.preflight.missing_extensions.length||Object.values(platform).some(v=>!v)){console.log(JSON.stringify({total_count:manifest.total_count,sequence_sha256:manifest.sequence_sha256,preflight:manifest.preflight},null,2));throw new Error('FULL_SEQUENCE_PLATFORM_UNAVAILABLE: no migration attempted; see complete manifest. Do not replace platform dependencies with stubs.');}
 assert.equal(manifest.preflight.public_relations,0,'Rehearsal requires an empty application schema');
 for(let n=0;n<snapshot.length;n++){
  const source=snapshot[n],entry=manifest.migrations[n];assert.equal(createHash('sha256').update(readFileSync(root+'/'+source.file)).digest('hex'),entry.sha256,'Migration changed during rehearsal');entry.status='running';save();
  try {await run('begin;\n'+source.sql+'\ncommit;');entry.status='applied';manifest.applied_count++;save();console.log('APPLIED '+source.file+' SHA256 '+entry.sha256);}
  catch(error){entry.status='failed';entry.error=String(error);save();throw error;}
 }
 assert.deepEqual(readdirSync(root).filter(f=>f.endsWith('.sql')).sort(),files,'Migration list changed during rehearsal');manifest.complete=true;save();return manifest.applied_count;
}
