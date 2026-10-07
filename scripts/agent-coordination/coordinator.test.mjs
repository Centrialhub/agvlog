import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {Coordinator} from './coordinator.mjs';
import {fileURLToPath} from 'node:url';

function fixture(){
 const entry=fs.mkdtempSync(path.join(os.tmpdir(),'agvlog-coordination-'));
 const root=path.join(entry,'integration');fs.mkdirSync(root);fs.mkdirSync(path.join(entry,'work'));
 const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-b','integration/local']);git(['config','core.autocrlf','false']);git(['config','user.name','AGVLOG guard fixture']);git(['config','user.email','guard@agvlog-test.invalid']);
 fs.writeFileSync(path.join(root,'shared.txt'),'initial\n');git(['add','shared.txt']);git(['commit','-m','fixture baseline']);const sha=git(['rev-parse','HEAD']);
 const state={formatVersion:1,published:{sha,url:'https://agvlog-test.invalid/release.json'},integration:{path:root,branch:'integration/local',head:sha,commonDirectory:path.join(root,'.git')},protected:[],tasks:[],queue:[],history:[],checks:[[process.execPath,'-e','process.exit(0)']],validation:{sha,status:'pending'}};
 fs.writeFileSync(path.join(entry,'state.json'),JSON.stringify(state));
 const hooks=path.join(entry,'hooks');fs.mkdirSync(hooks);
 const engine=fileURLToPath(new URL('./coordinator.mjs',import.meta.url)).replaceAll('\\','/');
 fs.writeFileSync(path.join(hooks,'pre-commit'),`#!/bin/sh\nexport AGVLOG_ENTRY='${entry.replaceAll('\\','/')}'\nexec node '${engine}' hook-commit\n`,{mode:0o755});
 // Fixture uses an in-process release probe. Hooks test owner/checkout rejection
 // before network; successful fixture commits use local-only hook test setup.
 git(['config','core.hooksPath',hooks.replaceAll('\\','/')]);
 const c=new Coordinator(entry,{releaseProbe:async()=>sha});
 const disableHook=()=>git(['config','core.hooksPath',path.join(entry,'no-hooks')]);
 const enableHook=()=>git(['config','core.hooksPath',hooks]);
 return {entry,root,git,sha,c,disableHook,enableHook};
}
const options=(id,files)=>({id,owner:id,purpose:`Fixture ${id}`,files});
async function writeCommit(f,id,file,contents){const t=f.c.state().tasks.find(x=>x.id===id);fs.writeFileSync(path.join(t.path,file),contents);await f.c.stage({id,owner:id,files:[file]});return (await f.c.commit({id,owner:id,message:`${id} change`})).sha;}

test('two agents retain independent commits through stale-base rejection, sync and serial integration',async()=>{
 const f=fixture();f.disableHook();const a=await f.c.newTask(options('agent-a',['a.txt'])),b=await f.c.newTask(options('agent-b',['b.txt']));
 const ac=await writeCommit(f,'agent-a','a.txt','A\n'),bc=await writeCommit(f,'agent-b','b.txt','B\n');
 await f.c.enqueue({id:a.id,owner:a.owner});const first=await f.c.integrate();assert.equal(first.status,'passed');
 await assert.rejects(f.c.enqueue({id:b.id,owner:b.owner}),/stale base/);
 await f.c.sync({id:b.id,owner:b.owner});await f.c.enqueue({id:b.id,owner:b.owner});const final=await f.c.integrate();
 assert.equal(final.status,'passed');assert.equal(fs.readFileSync(path.join(f.root,'a.txt'),'utf8'),'A\n');assert.equal(fs.readFileSync(path.join(f.root,'b.txt'),'utf8'),'B\n');
 assert.ok(f.c.ancestor(f.root,ac,final.sha));assert.ok(f.c.ancestor(f.root,bc,final.sha));assert.ok(f.c.ancestor(f.root,first.sha,final.sha));
 assert.equal(f.c.state().history.length,2);assert.equal(f.c.state().queue.length,0);
 assert.throws(()=>f.c.publish(),/not authorized/);
});
test('ownership collision is refused before parallel edits',async()=>{
 const f=fixture();await f.c.newTask(options('agent-a',['src/**']));
 await assert.rejects(f.c.newTask(options('agent-b',['src/hooks/x.ts'])),/already owned/);
 assert.equal(f.c.state().tasks.length,1);assert.equal(f.git(['for-each-ref','refs/heads/task/agent-b']),'');
});
test('real merge conflict is retained, both commits survive, and integration is untouched',async()=>{
 const f=fixture();f.disableHook();const a=await f.c.newTask(options('agent-a',['shared.txt'])),b=await f.c.newTask(options('agent-b',['b.txt']));
 const ac=await writeCommit(f,a.id,'shared.txt','A version\n');await f.c.enqueue({id:a.id,owner:a.owner});await f.c.integrate();const integration=f.c.state().integration.head;
 // Ownership transfers only after A is integrated. B deliberately edits its old
 // snapshot to simulate a direct editor bypass; enqueue/commit managed commands
 // reject this stale base. The direct fixture commit reproduces a real conflict.
 await f.c.claim({id:b.id,owner:b.owner,files:['shared.txt']});fs.writeFileSync(path.join(b.path,'shared.txt'),'B version\n');
 f.c.git(b.path,['add','shared.txt']);f.c.git(b.path,['commit','-m','external stale editor']);const bc=f.c.head(b.path);
 await assert.rejects(f.c.sync({id:b.id,owner:b.owner}),/conflict retained/);
 assert.equal(f.c.head(f.root),integration);assert.ok(f.c.ancestor(f.root,ac,integration));assert.equal(f.c.head(b.path),bc);
 assert.deepEqual(f.c.state().tasks.find(x=>x.id===b.id).conflict.paths,['shared.txt']);
 assert.match(fs.readFileSync(path.join(b.path,'shared.txt'),'utf8'),/<<<<<<< HEAD/);assert.ok(f.c.ancestor(b.path,f.sha,bc));
 // Resolve explicitly in the same task, preserving both original commits.
 fs.writeFileSync(path.join(b.path,'shared.txt'),'A version\nB version\n');f.c.git(b.path,['add','shared.txt']);
 await f.c.resolveSync({id:b.id,owner:b.owner});await f.c.enqueue({id:b.id,owner:b.owner});await f.c.integrate();
 assert.ok(f.c.ancestor(f.root,ac,f.c.head(f.root)));assert.ok(f.c.ancestor(f.root,bc,f.c.head(f.root)));
});
test('wrong checkout, owner, branch, protected base and unowned paths fail closed',async()=>{
 const f=fixture();const a=await f.c.newTask(options('agent-a',['a.txt']));
 await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:f.root}),/wrong checkout/);
 await assert.rejects(f.c.check({id:a.id,owner:'agent-b',cwd:a.path}),/owner mismatch/);
 f.c.git(a.path,['switch','-c','wrong-branch']);await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:a.path}),/wrong or detached/);
 f.c.git(a.path,['switch',a.branch]);await assert.rejects(f.c.stage({id:a.id,owner:a.owner,files:['shared.txt']}),/outside task ownership/);
 const s=f.c.state();s.protected.push({path:a.path,role:'legacy'});f.c.save(s);await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:a.path}),/legacy/);
});
test('dirty integration, changed queue tip and published-base drift block integration',async()=>{
 const f=fixture();f.disableHook();const a=await f.c.newTask(options('agent-a',['a.txt']));await writeCommit(f,a.id,'a.txt','A\n');await f.c.enqueue({id:a.id,owner:a.owner});
 fs.writeFileSync(path.join(f.root,'untracked.txt'),'preserve');await assert.rejects(f.c.integrate(),/dirty tree/);assert.equal(fs.readFileSync(path.join(f.root,'untracked.txt'),'utf8'),'preserve');
 // This file belongs only to the disposable fixture; remove no existing work.
 fs.unlinkSync(path.join(f.root,'untracked.txt'));
 await writeCommit(f,a.id,'a.txt','A2\n');await assert.rejects(f.c.integrate(),/queued task changed/);
 const drift=new Coordinator(f.entry,{releaseProbe:async()=>'0'.repeat(40)});await assert.rejects(drift.check({id:a.id,owner:a.owner,cwd:a.path}),/published base changed/);
});
test('lock serializes coordinators and does not remove another owner lease',async()=>{
 const f=fixture(),unlock=f.c.lock('held');await assert.rejects(f.c.newTask(options('agent-a',['a.txt'])),/busy/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.entry,'coordination.lock'))).operation,'held');unlock();assert.equal(fs.existsSync(path.join(f.entry,'coordination.lock')),false);
});
test('real pre-commit refuses direct commits without task identity and integration queue',async()=>{
 const f=fixture();const a=await f.c.newTask(options('agent-a',['a.txt']));fs.writeFileSync(path.join(a.path,'a.txt'),'A\n');f.c.git(a.path,['add','a.txt']);
 assert.throws(()=>f.c.git(a.path,['commit','-m','wrong owner']),/Command failed/);assert.equal(f.c.head(a.path),f.sha);
 fs.writeFileSync(path.join(f.root,'base.txt'),'base');f.git(['add','base.txt']);assert.throws(()=>f.git(['commit','-m','unsafe base commit']),/Command failed/);assert.equal(f.c.head(f.root),f.sha);
});
test('post-integration check failure keeps all commits and blocks publication',async()=>{
 const f=fixture();f.disableHook();const s=f.c.state();s.checks=[[process.execPath,'-e','process.exit(7)']];f.c.save(s);
 const a=await f.c.newTask(options('agent-a',['a.txt']));const ac=await writeCommit(f,a.id,'a.txt','A\n');await f.c.enqueue({id:a.id,owner:a.owner});
 await assert.rejects(f.c.integrate(),/checks did not pass/);assert.equal(f.c.state().validation.status,'failed');assert.ok(f.c.ancestor(f.root,ac,f.c.head(f.root)));assert.throws(()=>f.c.publish(),/not authorized/);
});
test('Git hook environment cannot redirect inspection of the integration worktree',async()=>{
 const f=fixture(),a=await f.c.newTask(options('agent-a',['a.txt']));
 const names=['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_PREFIX'];
 const before=Object.fromEntries(names.map(x=>[x,process.env[x]]));
 const taskGit=f.c.git(a.path,['rev-parse','--absolute-git-dir']);
 try{
  process.env.GIT_DIR=taskGit;process.env.GIT_WORK_TREE=a.path;process.env.GIT_INDEX_FILE=path.join(taskGit,'index');process.env.GIT_PREFIX='src/';
  assert.equal(f.c.branch(f.root),'integration/local');
  const checked=await f.c.check({id:a.id,owner:a.owner,cwd:a.path});
  assert.equal(checked.integrationHead,f.sha);assert.equal(checked.branch,a.branch);
 }finally{for(const name of names)if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}
});
test('pinned external inputs merge in an owned worktree and retain both histories',async()=>{
 const f=fixture();f.disableHook();const other=path.join(f.entry,'prior');f.git(['worktree','add','-b','fixture/prior',other,f.sha]);
 fs.writeFileSync(path.join(other,'prior.txt'),'prior update\n');f.c.git(other,['add','prior.txt']);f.c.git(other,['commit','-m','prior input']);const prior=f.c.head(other);
 const a=await f.c.newTask(options('agent-a',['**']));await writeCommit(f,a.id,'manual.txt','manual update\n');const manual=f.c.head(a.path);
 const s=f.c.state();s.preservedInputs=[{role:'prior-fixture',sha:prior}];f.c.save(s);
 await assert.rejects(f.c.beginExternal({id:a.id,owner:a.owner,sha:'f'.repeat(40),label:'unknown'}),/not pinned/);
 const merge=await f.c.beginExternal({id:a.id,owner:a.owner,sha:prior,label:'prior update'});assert.equal(merge.status,'ready');
 await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:a.path}),/unresolved merge/);
 const checked=await f.c.check({id:a.id,owner:a.owner,cwd:a.path,operation:'resolve-external'});assert.equal(checked.external.sha,prior);
 const done=await f.c.finishExternal({id:a.id,owner:a.owner});assert.ok(f.c.ancestor(a.path,manual,done.sha));assert.ok(f.c.ancestor(a.path,prior,done.sha));
 await f.c.enqueue({id:a.id,owner:a.owner});await f.c.integrate();assert.ok(f.c.ancestor(f.root,prior,f.c.head(f.root)));assert.ok(f.c.ancestor(f.root,manual,f.c.head(f.root)));
});

test('corrections fork the exact candidate while its original worktree permits only immutable tests',async()=>{
 const f=fixture();f.disableHook();const a=await f.c.newTask(options('review-a',['**']));
 const sha=await writeCommit(f,a.id,'shared.txt','reviewed snapshot\n');
 const input={id:a.id,owner:a.owner,sha,newId:'correction-a',newOwner:'fix-owner',purpose:'Correct reviewed blocker',files:['**']};
 await assert.rejects(f.c.forkFrozen({...input,owner:'wrong-owner'}),/owner mismatch/);
 await assert.rejects(f.c.forkFrozen({...input,sha:f.sha}),/exact clean/);
 const b=await f.c.forkFrozen(input);
 assert.equal(f.c.head(a.path),sha);assert.equal(f.c.head(b.path),sha);assert.equal(f.c.head(f.root),f.sha);
 assert.equal((await f.c.check({id:a.id,owner:a.owner,cwd:a.path,operation:'test'})).frozen,true);
 await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:a.path}),/frozen review/);
 await assert.rejects(f.c.stage({id:a.id,owner:a.owner,files:['shared.txt']}),/frozen review/);
 await f.c.check({id:b.id,owner:b.owner,cwd:b.path});
 fs.writeFileSync(path.join(b.path,'shared.txt'),'corrected separately\n');
 await f.c.stage({id:b.id,owner:b.owner,files:['shared.txt']});await f.c.commit({id:b.id,owner:b.owner,message:'Separate correction'});
 assert.equal(fs.readFileSync(path.join(a.path,'shared.txt'),'utf8'),'reviewed snapshot\n');assert.equal(f.c.head(a.path),sha);
 await f.c.enqueue({id:b.id,owner:b.owner});await f.c.integrate();
 assert.equal((await f.c.check({id:a.id,owner:a.owner,cwd:a.path,operation:'test'})).head,sha);
 fs.writeFileSync(path.join(a.path,'untracked.txt'),'unexpected edit');
 await assert.rejects(f.c.check({id:a.id,owner:a.owner,cwd:a.path,operation:'test'}),/dirty tree/);
});
