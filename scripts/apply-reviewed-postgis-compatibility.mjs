import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const sqlPath='supabase/platform/postgis_3_3_7_sql_compatibility.sql';
const provenancePath='supabase/platform/postgis_3_3_7_sql_compatibility.provenance.json';
const approvedSql='0a0c4c0131b19edbef5c0bf0b419876bd30c141cb874a1b92bb9dc5922f82895';
const approvedProvenance='fdf628ee57e062c64772681d86075a3bf729f6a132a6c6ba59f3d503e548c3c9';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireCondition=(value,code)=>{if(!value)throw new Error(code);};

export function verifyPostgisPackage(repositoryRoot=root){
 for(const path of [sqlPath,provenancePath])requireCondition(lstatSync(join(repositoryRoot,path)).isFile()&&!lstatSync(join(repositoryRoot,path)).isSymbolicLink(),'postgis_package_regular_files_required');
 const bytes=readFileSync(join(repositoryRoot,sqlPath));
 requireCondition(sha(bytes)===approvedSql,'postgis_package_hash_changed');
 const provenanceBytes=readFileSync(join(repositoryRoot,provenancePath));
 requireCondition(sha(provenanceBytes)===approvedProvenance,'postgis_provenance_hash_changed');
 const provenance=JSON.parse(provenanceBytes);
 requireCondition(provenance.sqlSha256===approvedSql&&provenance.upstreamVersion==='3.3.7'&&provenance.productionOwnerRolloutRequired===true&&provenance.functions.length===6&&provenance.functions.every(f=>f.owner==='supabase_admin'),'postgis_provenance_changed');
 return {bytes,sqlSha256:approvedSql,functions:provenance.functions};
}

export function assertLocalPostgisTarget({database,network,inventory}){
 requireCondition(database.name==='/supabase_db_agvlog-local-staging'&&database.project==='agvlog-local-staging'&&database.running===true&&database.network==='agvlog-local-staging-loopback','postgis_local_database_required');
 const ports=database.ports?.['5432/tcp'];
 requireCondition(Array.isArray(ports)&&ports.length>0&&ports.every(p=>['127.0.0.1','::1'].includes(p.HostIp)&&p.HostPort==='55322'),'postgis_loopback_binding_required');
 requireCondition(network.Name==='agvlog-local-staging-loopback'&&network.Driver==='bridge'&&network.Options?.['com.docker.network.bridge.host_binding_ipv4']==='127.0.0.1'&&Object.keys(network.Containers??{}).length===9,'postgis_exclusive_fixture_network_required');
 requireCondition(inventory.public_tables===327&&inventory.users===7&&inventory.fixture_tenants===2&&inventory.active_jobs===0&&inventory.secret_values===0&&inventory.pending_http===0&&inventory.server_version>=170000&&inventory.server_version<180000,'postgis_synthetic_fixture_required');
}

export function applyReviewedPostgisCompatibility(repositoryRoot=root){
 requireCondition(process.platform==='linux'&&process.env.CI==='true','postgis_ephemeral_linux_ci_required');
 requireCondition(!process.env.DOCKER_HOST||process.env.DOCKER_HOST==='unix:///var/run/docker.sock','postgis_local_daemon_required');
 const packageInfo=verifyPostgisPackage(repositoryRoot);
 const env={PATH:`${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,HOME:process.env.HOME,LANG:'C.UTF-8'};
 const run=(command,args,input)=>execFileSync(command,args,{cwd:repositoryRoot,env,encoding:'utf8',input,stdio:[input?'pipe':'ignore','pipe','pipe'],timeout:30000,maxBuffer:2*1024*1024}).trim();
 const sourceSha=run('/usr/bin/git',['rev-parse','HEAD']);
 requireCondition(/^[a-f0-9]{40}$/.test(sourceSha)&&run('/usr/bin/git',['status','--porcelain'])==='','postgis_clean_source_required');
 const docker=(args,input)=>run('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],input);
 const format='{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}';
 const database=JSON.parse(docker(['inspect','--format',format,'supabase_db_agvlog-local-staging']));
 const [network]=JSON.parse(docker(['network','inspect','agvlog-local-staging-loopback']));
 const inventorySql="select json_build_object('public_tables',(select count(*) from pg_tables where schemaname='public'),'users',(select count(*) from auth.users),'fixture_tenants',(select count(*) from public.tenants where id in('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002') and settings->'fixture'='true'::jsonb),'active_jobs',(select count(*) from cron.job where active),'secret_values',(select count(*) from vault.secrets),'pending_http',(select count(*) from net.http_request_queue),'server_version',current_setting('server_version_num')::int)";
 const inventory=JSON.parse(docker(['exec','supabase_db_agvlog-local-staging','psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',inventorySql]));
 assertLocalPostgisTarget({database,network,inventory});
 docker(['exec','-i','supabase_db_agvlog-local-staging','psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-f','-'],packageInfo.bytes);
 return {sourceSha,sqlSha256:approvedSql,functions:6,sqlExecuted:true,owner:'supabase_admin',aclOrOwnerChanges:false,environment:'isolated synthetic local CI only',productionOwnerRolloutRequired:true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{requireCondition(process.argv.length===2,'postgis_explicit_local_ci_command_required');console.log(JSON.stringify(applyReviewedPostgisCompatibility()));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
