import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const fail=message=>{throw new Error(`AGVLOG guard: ${message}`);};
const literalPath=value=>path.resolve(value);
const canonical=value=>fs.realpathSync.native(literalPath(value)).replaceAll('\\','/').toLowerCase();
const stamp=()=>new Date().toISOString();
const parseStatus=raw=>raw.split('\0').filter(Boolean);
// Git exports repository/index variables into hooks. Clear its documented local
// environment before a hook inspects a different worktree or repository.
const localGitEnvironment=execFileSync('git',['rev-parse','--local-env-vars'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/);
export class Coordinator {
 constructor(entry,{releaseProbe}={}) {
  this.entry=literalPath(entry);this.file=path.join(this.entry,'state.json');
  this.releaseProbe=releaseProbe??(async url=>{
   const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok)fail(`release lookup failed (${r.status})`);
   return (await r.json()).release;
  });
 }
 state(){return JSON.parse(fs.readFileSync(this.file,'utf8'));}
 save(state){const tmp=`${this.file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,this.file);}
 git(root,args,env={}){const environment={...process.env,...env};for(const key of localGitEnvironment)delete environment[key];return execFileSync('git',['-c',`safe.directory=${literalPath(root).replaceAll('\\','/')}`,'--no-optional-locks','-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024,env:environment,stdio:['ignore','pipe','pipe']}).trim();}
 head(root){return this.git(root,['rev-parse','HEAD']);}
 branch(root){try{return this.git(root,['symbolic-ref','--quiet','--short','HEAD']);}catch(e){if(e.status===1)return null;throw e;}}
 clean(root){if(this.git(root,['status','--porcelain=v1','--untracked-files=all']))fail(`dirty tree: ${root}; preserve changes before proceeding`);}
 ancestor(root,a,b){try{this.git(root,['merge-base','--is-ancestor',a,b]);return true;}catch(e){if(e.status===1)return false;throw e;}}
 task(state,id,owner){const t=state.tasks.find(x=>x.id===id);if(!t)fail('unknown task; use the canonical entry');if(owner!==t.owner)fail('task owner mismatch');return t;}
 integration(state){const i=state.integration;if(this.branch(i.path)!==i.branch)fail('integration branch changed');if(this.head(i.path)!==i.head)fail('integration HEAD changed outside the queue');return i;}
 relative(file){if(typeof file!=='string'||file.length===0||file.includes('\\')||file.startsWith('/')||file.split('/').some(x=>!x||x==='..'||x==='.')||file.startsWith('-')||file.includes('\0')||file.includes(':'))fail('invalid owned path');if(file==='.git'||file.startsWith('.git/'))fail('Git internals cannot be task files');return file;}
 owns(t,file){return t.files.some(x=>x==='**'||(x.endsWith('/**')?(file===x.slice(0,-3)||file.startsWith(x.slice(0,-2))):file===x));}
 overlaps(a,b){return a==='**'||b==='**'||a===b||(a.endsWith('/**')&&this.owns({files:[a]},b.replace(/\/\*\*$/,'')))||(b.endsWith('/**')&&this.owns({files:[b]},a.replace(/\/\*\*$/,'')));}
 claimCheck(state,id,files){for(const f of files)this.relative(f);for(const t of state.tasks.filter(x=>x.id!==id&&!['integrated','closed','frozen'].includes(x.status)))for(const a of files)for(const b of t.files)if(this.overlaps(a,b))fail(`file already owned by ${t.id}: ${a}`);}
 async published(state){const live=await this.releaseProbe(state.published.url);if(live!==state.published.sha)fail(`published base changed: ${live}; reconcile explicitly before editing or integrating`);}
 lock(operation){const file=path.join(this.entry,'coordination.lock');const lease={operation,pid:process.pid,token:randomUUID(),startedAt:stamp()};let fd;try{fd=fs.openSync(file,'wx');}catch(e){if(e.code==='EEXIST')fail('integration/coordinator busy; inspect the lease, never delete an unknown lock');throw e;}fs.writeFileSync(fd,JSON.stringify(lease));fs.closeSync(fd);return ()=>{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.token!==lease.token)fail('lock ownership changed');fs.unlinkSync(file);};}
 async locked(operation,fn){const unlock=this.lock(operation);try{return await fn();}finally{unlock();}}
 hookEnv(t,operation){return {AGVLOG_ENTRY:this.entry,AGVLOG_TASK:t.id,AGVLOG_OWNER:t.owner,AGVLOG_COORDINATED_OPERATION:operation};}
 lease(operation){const f=path.join(this.entry,'coordination.lock');if(!fs.existsSync(f))fail('managed operation requires its coordinator lease');const l=JSON.parse(fs.readFileSync(f));if(l.operation!==operation)fail('coordinator operation mismatch');}
 async check({id,owner,cwd,operation='edit',hook=false}){
  const state=this.state(),root=this.git(cwd,['rev-parse','--show-toplevel']);
  const deny=state.protected.find(x=>canonical(x.path)===canonical(root));if(deny)fail(`${deny.role}: ${deny.path}; enter ${this.entry}`);
  const t=this.task(state,id,owner);if(canonical(root)!==canonical(t.path))fail('wrong checkout for this task');
  if(this.branch(root)!==t.branch||!this.branch(root))fail('wrong or detached task branch');
  if(canonical(path.resolve(root,this.git(root,['rev-parse','--git-common-dir'])))!==canonical(state.integration.commonDirectory))fail('different repository identity');
  const i=this.integration(state);
  if(!this.ancestor(root,state.published.sha,this.head(root)))fail('published hotfix missing from task ancestry');
  if(t.status==='frozen'){
   if(operation!=='test')fail('frozen review candidate; edit only its assigned correction fork');
   if(this.head(root)!==t.frozen.sha||this.git(root,['rev-parse','HEAD^{tree}'])!==t.frozen.tree)fail('frozen candidate changed');
   this.clean(root);await this.published(state);
   return {task:t.id,owner:t.owner,path:root,branch:t.branch,head:t.frozen.sha,tree:t.frozen.tree,frozen:true,operation};
  }
  if(operation==='sync-hook'){
   this.lease(`sync:${t.id}`);const mergeHead=this.git(root,['rev-parse','MERGE_HEAD']);if(mergeHead!==i.head)fail('sync merge source changed');return t;
  }
  if(operation==='resolve-external'||operation==='external-merge-hook'){
   const x=t.external;if(!x||x.before!==this.head(root)||x.integrationHead!==i.head||this.git(root,['rev-parse','MERGE_HEAD'])!==x.sha)fail('external merge context changed');
   if(operation==='external-merge-hook')this.lease(`external:${t.id}`);
   await this.published(state);return {task:t.id,owner:t.owner,path:root,external:x};
  }
  if(!['edit','test','commit','stage','enqueue'].includes(operation))fail('unsupported operation');
  if(!['working','queued'].includes(t.status))fail(`task is ${t.status}`);
  if(t.syncedTo!==i.head||!this.ancestor(root,i.head,this.head(root)))fail('stale base; use sync before editing, testing or committing');
  if(fs.existsSync(path.resolve(root,this.git(root,['rev-parse','--git-path','MERGE_HEAD']))))fail('unresolved merge; preserve it and coordinate resolution');
  if(operation==='commit'){
   const names=parseStatus(this.git(root,['diff','--cached','--name-only','-z']));
   if(!names.length)fail('no staged change');for(const f of names)if(!this.owns(t,f))fail(`staged path outside task ownership: ${f}`);
  }
  await this.published(state);
  return {task:t.id,owner:t.owner,path:root,branch:t.branch,head:this.head(root),integrationHead:i.head,published:state.published.sha,operation,hook};
 }
 async newTask({id,owner,purpose,files}){return this.locked(`new:${id}`,async()=>{
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(id)||!owner||!purpose||!Array.isArray(files)||!files.length)fail('task requires slug, owner, purpose and explicit files');
  const s=this.state();if(s.tasks.some(t=>t.id===id))fail('task already exists');this.claimCheck(s,id,files);const i=this.integration(s);this.clean(i.path);await this.published(s);
  const destination=path.join(this.entry,'work',id);if(fs.existsSync(destination))fail('destination exists; no overwrite');
  const branch=`task/${id}`;if(this.git(i.path,['for-each-ref',`refs/heads/${branch}`]))fail('task branch already exists');
  this.git(i.path,['worktree','add','-b',branch,destination,i.head]);
  const t={id,owner,purpose,files,path:destination,branch,originalBase:i.head,syncedTo:i.head,status:'working',createdAt:stamp(),commits:[]};s.tasks.push(t);this.save(s);return t;
 });}
 async claim({id,owner,files}){return this.locked(`claim:${id}`,async()=>{const s=this.state(),t=this.task(s,id,owner);this.claimCheck(s,id,files);t.files=[...new Set([...t.files,...files])];this.save(s);return t;});}
 async forkFrozen({id,owner,sha,newId,newOwner,purpose,files}){return this.locked(`fork-frozen:${id}`,async()=>{
  const s=this.state(),source=this.task(s,id,owner),i=this.integration(s);
  await this.check({id,owner,cwd:source.path});this.clean(source.path);this.clean(i.path);
  if(source.status!=='working'||source.external||s.queue.some(x=>x.id===id)||this.head(source.path)!==sha)fail('fork requires the exact clean working candidate');
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(newId)||!newOwner||!purpose||!Array.isArray(files)||!files.length||s.tasks.some(x=>x.id===newId))fail('invalid correction fork');
  source.status='frozen';source.frozen={sha,tree:this.git(source.path,['rev-parse','HEAD^{tree}']),at:stamp(),correctionTask:newId};
  this.claimCheck(s,newId,files);
  const destination=path.join(this.entry,'work',newId),branch=`task/${newId}`;
  if(fs.existsSync(destination)||this.git(i.path,['for-each-ref',`refs/heads/${branch}`]))fail('correction destination already exists; preserve it');
  this.git(i.path,['worktree','add','-b',branch,destination,sha]);
  const t={id:newId,owner:newOwner,purpose,files,path:destination,branch,originalBase:i.head,syncedTo:i.head,status:'working',createdAt:stamp(),commits:[],forkedFrom:{task:id,sha,tree:source.frozen.tree}};
  s.tasks.push(t);this.save(s);return t;
 });}
 async stage({id,owner,files}){const s=this.state(),t=this.task(s,id,owner);await this.check({id,owner,cwd:t.path,operation:'stage'});for(const f of files){this.relative(f);if(!this.owns(t,f))fail(`path outside task ownership: ${f}`);}if(!files.length)fail('explicit staged paths required');this.git(t.path,['add','--',...files]);return {staged:files};}
 async commit({id,owner,message}){return this.locked(`commit:${id}`,async()=>{const s=this.state(),t=this.task(s,id,owner);await this.check({id,owner,cwd:t.path,operation:'commit'});if(!message?.trim())fail('commit message required');this.git(t.path,['commit','-m',message],this.hookEnv(t,'commit'));const sha=this.head(t.path);t.commits.push({sha,base:t.syncedTo,at:stamp()});this.save(s);return {sha};});}
 async sync({id,owner}){return this.locked(`sync:${id}`,async()=>{
  const s=this.state(),t=this.task(s,id,owner),i=this.integration(s);this.clean(i.path);this.clean(t.path);await this.published(s);
  if(this.branch(t.path)!==t.branch)fail('wrong task branch');
  if(!this.ancestor(t.path,t.originalBase,this.head(t.path)))fail('original task ancestry lost');
  if(t.syncedTo===i.head)return {state:'already-current'};
  const before=this.head(t.path);t.status='syncing';this.save(s);
  try{this.git(t.path,['merge','--no-ff','--no-commit',i.head],this.hookEnv(t,'sync'));}
  catch(e){t.status='conflict';t.conflict={at:stamp(),taskHead:before,integrationHead:i.head,paths:parseStatus(this.git(t.path,['diff','--name-only','--diff-filter=U','-z']))};this.save(s);fail('sync conflict retained in task worktree; integration and commits preserved');}
  if(this.head(t.path)===before&&fs.existsSync(path.resolve(t.path,this.git(t.path,['rev-parse','--git-path','MERGE_HEAD']))))this.git(t.path,['commit','-m',`Merge integration ${i.head.slice(0,12)} into task ${id}`],this.hookEnv(t,'sync-hook'));
  if(!this.ancestor(t.path,before,this.head(t.path))||!this.ancestor(t.path,i.head,this.head(t.path)))fail('sync lost ancestry');
  t.syncedTo=i.head;t.status='working';s.queue=s.queue.filter(q=>q.task!==id);this.save(s);return {head:this.head(t.path),preserved:before,syncedTo:i.head};
 });}
 async resolveSync({id,owner}){return this.locked(`sync:${id}`,async()=>{
  const s=this.state(),t=this.task(s,id,owner),i=this.integration(s);
  if(t.status!=='conflict'||!t.conflict||t.conflict.integrationHead!==i.head)fail('conflict context changed; coordinate before resolving');
  if(this.branch(t.path)!==t.branch||this.head(t.path)!==t.conflict.taskHead||this.git(t.path,['rev-parse','MERGE_HEAD'])!==i.head)fail('conflict ancestry changed');
  if(this.git(t.path,['diff','--name-only','--diff-filter=U']))fail('unresolved conflict remains');
  const changes=parseStatus(this.git(t.path,['diff','--cached','--name-only','-z',i.head]));for(const f of changes)if(!this.owns(t,f))fail(`resolution outside task ownership: ${f}`);
  await this.published(s);this.git(t.path,['commit','-m',`Resolve integration sync for ${id}`],this.hookEnv(t,'sync-hook'));
  if(!this.ancestor(t.path,t.conflict.taskHead,this.head(t.path))||!this.ancestor(t.path,i.head,this.head(t.path)))fail('resolution lost ancestry');
  t.syncedTo=i.head;t.status='working';t.conflict=null;s.queue=s.queue.filter(q=>q.task!==id);this.save(s);return {head:this.head(t.path),syncedTo:i.head};
 });}
 async enqueue({id,owner}){return this.locked(`enqueue:${id}`,async()=>{
  const s=this.state(),t=this.task(s,id,owner),i=this.integration(s);await this.check({id,owner,cwd:t.path,operation:'enqueue'});this.clean(t.path);this.clean(i.path);
  if(s.queue.some(q=>q.task===id))fail('task already queued');const head=this.head(t.path);if(head===i.head)fail('no task commits to integrate');
  const changes=parseStatus(this.git(t.path,['diff','--name-only','-z',i.head,head]));for(const f of changes)if(!this.owns(t,f))fail(`task change outside ownership: ${f}`);
  s.queue.push({task:id,owner,head,base:i.head,submittedAt:stamp(),paths:changes});t.status='queued';this.save(s);return s.queue.at(-1);
 });}
 async beginExternal({id,owner,sha,label}){return this.locked(`external:${id}`,async()=>{
  const s=this.state(),t=this.task(s,id,owner),i=this.integration(s);await this.check({id,owner,cwd:t.path});this.clean(t.path);this.clean(i.path);
  if(!/^[a-f0-9]{40}$/.test(sha)||!s.preservedInputs?.some(x=>x.sha===sha&&x.role.startsWith('prior-')))fail('external input is not pinned and preserved');
  this.git(t.path,['cat-file','-e',`${sha}^{commit}`]);if(this.ancestor(t.path,sha,this.head(t.path)))return {state:'already-included',sha};
  t.external={sha,label,before:this.head(t.path),integrationHead:i.head,startedAt:stamp(),status:'merging'};this.save(s);
  try{this.git(t.path,['merge','--no-ff','--no-commit',sha]);t.external.status='ready';}
  catch(e){t.external.status='conflict';t.external.paths=parseStatus(this.git(t.path,['diff','--name-only','--diff-filter=U','-z']));t.external.error=e.stderr?.toString().trim();if(!t.external.paths.length){this.save(s);throw e;}}
  this.save(s);return t.external;
 });}
 async finishExternal({id,owner,message}){return this.locked(`external:${id}`,async()=>{
  const s=this.state(),t=this.task(s,id,owner);await this.check({id,owner,cwd:t.path,operation:'resolve-external'});
  if(this.git(t.path,['diff','--name-only','--diff-filter=U']))fail('external conflict remains');
  const names=parseStatus(this.git(t.path,['diff','--cached','--name-only','-z',t.external.before]));for(const f of names)if(!this.owns(t,f))fail(`external merge outside ownership: ${f}`);
  const x=t.external;this.git(t.path,['commit','-m',message||`Reconcile ${x.label} preserving both histories`],this.hookEnv(t,'external-merge-hook'));
  const sha=this.head(t.path);if(!this.ancestor(t.path,x.before,sha)||!this.ancestor(t.path,x.sha,sha))fail('external merge lost input ancestry');
  t.commits.push({sha,base:t.syncedTo,external:x.sha,at:stamp()});t.external=null;this.save(s);return {sha,preserved:[x.before,x.sha]};
 });}
 async integrate(){return this.locked('integrate',async()=>{
  const s=this.state(),i=this.integration(s),q=s.queue[0];if(!q)fail('integration queue is empty');
  const t=this.task(s,q.task,q.owner);this.clean(i.path);this.clean(t.path);await this.published(s);
  if(q.base!==i.head||t.syncedTo!==i.head)fail('queued base is stale; sync and enqueue again');
  if(this.head(t.path)!==q.head||this.branch(t.path)!==t.branch)fail('queued task changed');
  const before=i.head;s.inProgress={task:t.id,before,taskHead:q.head,at:stamp()};this.save(s);
  try{this.git(i.path,['merge','--no-ff','--no-commit',q.head],this.hookEnv(t,'integrate'));}
  catch(e){s.inProgress.status='conflict';s.inProgress.paths=parseStatus(this.git(i.path,['diff','--name-only','--diff-filter=U','-z']));this.save(s);fail('integration conflict retained; do not reset or abort other work');}
  this.git(i.path,['commit','-m',`Integrate task ${t.id} cumulatively`],this.hookEnv(t,'integration-hook'));
  const after=this.head(i.path);if(!this.ancestor(i.path,before,after)||!this.ancestor(i.path,q.head,after))fail('integration ancestry lost');
  i.head=after;t.status='integrated';t.integrated={at:stamp(),head:q.head,integrationHead:after};s.queue.shift();s.inProgress=null;
  s.history.push({task:t.id,before,taskHead:q.head,after,at:stamp()});s.validation={sha:after,status:'pending',checks:[]};this.save(s);
  return this.verifyChecks(s);
 });}
 verifyChecks(s=this.state()){
  const i=this.integration(s);this.clean(i.path);const results=[];
  const logs=path.join(this.entry,'checks');fs.mkdirSync(logs,{recursive:true});
  for(const command of s.checks){const r=spawnSync(command[0],command.slice(1),{cwd:i.path,encoding:'utf8',shell:false,env:{...process.env,AGVLOG_ENTRY:this.entry}});const log=path.join(logs,`${i.head}-${randomUUID()}.log`);fs.writeFileSync(log,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''),{flag:'wx'});results.push({command,exit:r.status??1,log});if(r.status!==0)break;}
  this.clean(i.path);if(this.head(i.path)!==i.head)fail('checks changed integration HEAD');
  s.validation={sha:i.head,status:results.length===s.checks.length&&results.length>0&&results.every(r=>r.exit===0)?'passed':'failed',at:stamp(),checks:results};this.save(s);
  if(s.validation.status!=='passed')fail('post-integration checks did not pass; commits remain preserved');return s.validation;
 }
 async hookCommit(cwd,env=process.env){
  const s=this.state(),root=this.git(cwd,['rev-parse','--show-toplevel']);
  if(canonical(root)===canonical(s.integration.path)){
   this.lease('integrate');if(env.AGVLOG_COORDINATED_OPERATION!=='integration-hook'||!s.inProgress)fail('integration commits require the serial queue');
   const q=s.queue[0];if(this.git(root,['rev-parse','MERGE_HEAD'])!==q.head||this.head(root)!==s.inProgress.before)fail('integration merge changed');return {state:'serial-integration-commit'};
  }
  return this.check({id:env.AGVLOG_TASK,owner:env.AGVLOG_OWNER,cwd,operation:env.AGVLOG_COORDINATED_OPERATION==='sync-hook'?'sync-hook':env.AGVLOG_COORDINATED_OPERATION==='external-merge-hook'?'external-merge-hook':'commit',hook:true});
 }
 publish(){fail('publication is not authorized; a clean final SHA/gate alone does not authorize push, merge or deploy');}
}

export async function main(args=process.argv.slice(2)){
 const [command,...rest]=args;const options={};for(let k=0;k<rest.length;k+=2){if(!rest[k]?.startsWith('--')||rest[k+1]===undefined)fail('expected named arguments');options[rest[k].slice(2)]=rest[k+1];}
 const entry=options.entry??process.env.AGVLOG_ENTRY??'F:/AGVLOG';const c=new Coordinator(entry);
 const common={id:options.task,owner:options.owner};let result;
 if(command==='status')result=c.state();
 else if(command==='check')result=await c.check({...common,cwd:options.cwd??process.cwd(),operation:options.operation??'edit'});
 else if(command==='new')result=await c.newTask({...common,purpose:options.purpose,files:(options.files??'').split(',').filter(Boolean)});
 else if(command==='fork-frozen')result=await c.forkFrozen({...common,sha:options.sha,newId:options['new-task'],newOwner:options['new-owner'],purpose:options.purpose,files:(options.files??'').split(',').filter(Boolean)});
 else if(command==='claim')result=await c.claim({...common,files:(options.files??'').split(',').filter(Boolean)});
 else if(command==='stage')result=await c.stage({...common,files:(options.files??'').split(',').filter(Boolean)});
 else if(command==='commit')result=await c.commit({...common,message:options.message});
 else if(command==='sync')result=await c.sync(common);
 else if(command==='resolve-sync')result=await c.resolveSync(common);
 else if(command==='begin-external')result=await c.beginExternal({...common,sha:options.sha,label:options.label});
 else if(command==='finish-external')result=await c.finishExternal({...common,message:options.message});
 else if(command==='enqueue')result=await c.enqueue(common);
 else if(command==='integrate')result=await c.integrate();
 else if(command==='verify')result=c.verifyChecks();
 else if(command==='hook-commit')result=await c.hookCommit(process.cwd());
 else if(command==='publish'||command==='push'||command==='reset'||command==='clean'||command==='force'||command==='checkout')result=c.publish();
 else fail('supported commands: status, new, claim, check, stage, commit, sync, enqueue, integrate, verify');
 console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
