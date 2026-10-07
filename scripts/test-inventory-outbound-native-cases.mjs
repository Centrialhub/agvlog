import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {buildStockBalanceFixture,STOCK_IDS as i,PREDECESSOR_MD5} from './stock-balance-fixture.mjs';

const json=output=>{
 const line=String(output).split(/\r?\n/).filter(s=>/^[\[{]/.test(s.trim())).at(-1);
 assert.ok(line,`Missing JSON result: ${output}`);return JSON.parse(line);
};
const CONCURRENCY_CASES=7;
const CATALOG_SQL=`select json_build_object(
 'functions',(select json_agg(row_to_json(x) order by x.signature) from (
  select p.oid,p.oid::regprocedure::text signature,p.prosrc,p.proacl::text acl,p.proowner::regrole::text owner,
   l.lanname language,p.prorettype::regtype::text returns,p.proconfig,p.prosecdef,p.provolatile,p.prokind,
   p.proargtypes::text args,p.proargnames,p.proargdefaults::text defaults
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid in(
   'public.update_inventory_balance()'::regprocedure,'public.guard_inventory_movement_history()'::regprocedure,
   'public.create_inventory_movement_v1(jsonb)'::regprocedure,'public.is_tenant_admin(uuid)'::regprocedure)) x),
 'constraints',(select json_agg(row_to_json(x) order by x.relation,x.name) from (
  select c.conrelid::regclass::text relation,c.conname name,c.contype,c.convalidated,c.condeferrable,c.condeferred,
   pg_get_constraintdef(c.oid) definition from pg_constraint c where c.conrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)) x),
 'triggers',(select json_agg(row_to_json(x) order by x.relation,x.name) from (
  select t.oid,t.tgrelid::regclass::text relation,t.tgname name,t.tgfoid,t.tgtype,t.tgenabled,t.tgnargs,
   encode(t.tgargs,'hex') args,t.tgqual::text qual,pg_get_triggerdef(t.oid) definition from pg_trigger t
   where not t.tgisinternal and t.tgrelid in('public.inventory_balances'::regclass,'public.inventory_movements'::regclass)) x),
 'policies',(select json_agg(row_to_json(x) order by x.tablename,x.policyname) from (
  select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
  where schemaname='public' and tablename in('inventory_balances','inventory_movements')) x))`;

// No top-level execution, service launcher, configured DB URL, or fixture cleanup.
// Use only an explicitly owned disposable native cluster/database. PGlite may
// run sequential cases by supplying adapters and runConcurrency:false; it is
// never reported as native concurrency, JWT, PostgREST, or full A5 acceptance.
export async function runStockBalanceBlockerCases({
 query,queryError,contested,literal:q,forwardSql,root=process.cwd(),
 database='stock_balance_blocker_qa',createDatabase=true,runConcurrency=true,
 report=message=>console.log(message),
}){
 assert.equal(typeof query,'function');assert.equal(typeof queryError,'function');assert.equal(typeof q,'function');
 assert.equal(typeof forwardSql,'string');assert.ok(forwardSql.trim(),'The complete reviewed forward is required');
 assert.match(database,/^[a-z][a-z0-9_]{2,62}$/);
 if(runConcurrency)assert.equal(typeof contested,'function','Native lock assertions require contested; explicitly disable them only for PGlite');
 const fixture=buildStockBalanceFixture({root});
 if(createDatabase)await query(`create database ${database}`);
 const run=sql=>query(`reset role; ${sql}`,database);
 const fail=sql=>queryError(`reset role; ${sql}`,database);
 await run(fixture.sql);
 const identity=(user=i.actor)=>`select set_config('request.jwt.claim.sub',${q(user??'')},false); set role authenticated;`;
 const call=(p,user=i.actor)=>`${identity(user)} select public.create_inventory_movement_v1(${q(JSON.stringify(p))}::jsonb); reset role;`;
 const rpc=async(p,user=i.actor)=>json(await run(call(p,user)));
 const payload=(item,type='inbound',quantity=10,extra={})=>({
  tenant_id:i.tenant,request_id:randomUUID(),location_id:i.location,client_id:i.client,
  fiscal_document_id:i.document,movement_type:type,item_description:item,quantity,
  pallet_count:type==='outbound'?1:2,weight_kg:type==='outbound'?6:20,volume_m3:type==='outbound'?0.3:1,
  moved_at:type==='outbound'?'2026-10-05T19:00:00Z':'2026-10-05T18:00:00Z',...extra,
 });
 const item=label=>`QA ${label} ${randomUUID()}`;
 const state=()=>run(`select json_build_object(
  'balances',(select coalesce(json_agg(to_jsonb(b) order by id),'[]'::json) from public.inventory_balances b),
  'movements',(select coalesce(json_agg(to_jsonb(m) order by id),'[]'::json) from public.inventory_movements m))`).then(json);
 const balance=name=>run(`select to_jsonb(b) from public.inventory_balances b where tenant_id=${q(i.tenant)} and item_description=${q(name)}`).then(json);
 const factCount=name=>run(`select count(*) from public.inventory_movements where tenant_id=${q(i.tenant)} and item_description=${q(name)}`).then(x=>Number(x));
 const catalog=()=>run(CATALOG_SQL).then(json);
 const unchangedReject=async(sql,error)=>{const before=await state();assert.match(await fail(sql),error);assert.deepEqual(await state(),before);};
 let sequentialPassed=0,concurrencyPassed=0;
 const pass=label=>{sequentialPassed++;report(`PASS sequential: ${label}`);};
 const dimensions=(b,values)=>assert.deepEqual([b.quantity,b.pallet_count,b.weight_kg,b.volume_m3],values);

 const bugItem=item('reproduced'),input=payload(bugItem),out=payload(bugItem,'outbound',3);
 await rpc(input);
 assert.equal(await run("select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid='public.update_inventory_balance()'::regprocedure"),PREDECESSOR_MD5);
 await unchangedReject(call(out),/23514[\s\S]*inventory_balances_dimensions_nonnegative/);
 dimensions(await balance(bugItem),[10,2,20,1]);pass('captured predecessor rejects a sufficient outbound, atomically');

 await run('alter function public.update_inventory_balance() stable');
 const driftCatalog=await catalog();
 assert.match(await fail(`begin; ${forwardSql}\ncommit;`),/55000[\s\S]*inventory_outbound_predecessor_changed/);
 assert.deepEqual(await catalog(),driftCatalog,'Guard failure must leave the complete catalog unchanged');
 await run('alter function public.update_inventory_balance() volatile');
 pass('predecessor metadata drift fails the complete forward without partial changes');

 const beforeCatalog=await catalog();await run(`begin; ${forwardSql}\ncommit;`);const afterCatalog=await catalog();
 for(const key of ['constraints','triggers','policies'])assert.deepEqual(afterCatalog[key],beforeCatalog[key],`${key} changed`);
 assert.equal(afterCatalog.functions.length,beforeCatalog.functions.length);
 for(let n=0;n<beforeCatalog.functions.length;n++){
  const before=beforeCatalog.functions[n],after=afterCatalog.functions[n];
  if(before.signature==='update_inventory_balance()'||before.signature==='public.update_inventory_balance()'){
   const {prosrc:oldBody,...oldMetadata}=before,{prosrc:newBody,...newMetadata}=after;
   assert.notEqual(newBody,oldBody);assert.deepEqual(newMetadata,oldMetadata,'Balance OID/owner/ACL/type/volatility/search_path changed');
  }else assert.deepEqual(after,before,`Unrelated function changed: ${before.signature}`);
 }
 pass('full forward preserves OIDs, owner, ACLs, constraints, policies, triggers and unrelated functions');

 const first=await balance(bugItem),created=await rpc(out),after=await balance(bugItem);
 dimensions(after,[7,1,14,0.7]);assert.equal(after.first_inbound_at,first.first_inbound_at);
 assert.equal(Date.parse(after.last_movement_at),Date.parse(out.moved_at));assert.equal(await factCount(bugItem),2);
 assert.deepEqual(await rpc(out),created);assert.equal(await factCount(bugItem),2);dimensions(await balance(bugItem),[7,1,14,0.7]);
 await unchangedReject(call({...out,quantity:4}),/23505[\s\S]*inventory_request_conflict/);
 pass('valid outbound, exact four-dimensional balance, timestamps, replay and conflicting payload');

 for(const extra of [{quantity:8},{pallet_count:2},{weight_kg:15},{volume_m3:0.8}]){
  await unchangedReject(call(payload(bugItem,'outbound',1,extra)),/23514[\s\S]*insufficient_inventory_balance/);
 }
 await unchangedReject(call(payload(item('missing'),'outbound',1)),/23514[\s\S]*insufficient_inventory_balance/);
 pass('each insufficient dimension and missing balance reject without movements or timestamp changes');

 const adjustmentItem=item('adjustments');await rpc(payload(adjustmentItem));
 await rpc(payload(adjustmentItem,'adjustment',1,{adjustment_direction:'increase',pallet_count:0,weight_kg:2,volume_m3:0.1}));
 await rpc(payload(adjustmentItem,'adjustment',2,{adjustment_direction:'decrease',pallet_count:1,weight_kg:4,volume_m3:0.2}));
 dimensions(await balance(adjustmentItem),[9,1,18,0.9]);
 for(const direction of [null,undefined,'invalid']){
  await unchangedReject(call(payload(adjustmentItem,'adjustment',1,{adjustment_direction:direction,pallet_count:0,weight_kg:0,volume_m3:0})),
   direction==='invalid'?/23514[\s\S]*inventory_adjustment_direction/:/22023[\s\S]*inventory_adjustment_direction_required/);
 }
 pass('increase/decrease work; null, omitted and invalid adjustment directions reject');

 for(const [field,value,message] of [
  ['location_id',i.otherLocation,'inventory_location_not_found_in_tenant'],
  ['client_id',i.otherClient,'inventory_client_not_found_in_tenant'],
  ['fiscal_document_id',i.otherDocument,'inventory_document_not_found_in_tenant'],
 ])await unchangedReject(call(payload(item('foreign reference'),'inbound',1,{[field]:value})),new RegExp(`23503[\\s\\S]*${message}`));
 await unchangedReject(call(payload(item('foreign tenant'),'inbound',1,{tenant_id:i.otherTenant})),/42501[\s\S]*inventory_not_authorized/);
 await unchangedReject(call(payload(item('foreign actor')),i.otherActor),/42501[\s\S]*inventory_not_authorized/);
 await unchangedReject(call(payload(item('no actor')),null),/42501[\s\S]*inventory_not_authorized/);
 pass('foreign references, unrelated actor, foreign tenant and missing identity reject atomically');

 const nullable=item('null logical references');
 await rpc(payload(nullable,'inbound',10,{location_id:null,client_id:null}));
 await rpc(payload(nullable,'inbound',2,{location_id:null,client_id:null,pallet_count:0,weight_kg:0,volume_m3:0}));
 await rpc(payload(nullable,'outbound',3,{location_id:null,client_id:null}));
 dimensions(await balance(nullable),[9,1,14,0.7]);
 assert.equal(await run(`select count(*) from inventory_balances where tenant_id=${q(i.tenant)} and item_description=${q(nullable)}`),'1');
 pass('NULLS NOT DISTINCT logical key aggregates nullable client/location without duplicate balances');

 await unchangedReject(`update public.inventory_movements set quantity=99 where id=${q(created.id)}`,/55000[\s\S]*inventory_movement_history_is_immutable/);
 await unchangedReject(`delete from public.inventory_movements where id=${q(created.id)}`,/55000[\s\S]*inventory_movement_history_is_immutable/);
 pass('privileged UPDATE/DELETE of immutable movement history remain forbidden');

 const race=async(holder,waiter,{succeeds=true,blocked=true,after='',lockKind='row'}={})=>{
  const result=await contested(`reset role; ${holder}`,`reset role; ${waiter}`,{
   database,driver:false,waiterSucceeds:succeeds,waitForBlocking:blocked,holderAfterBlocked:after,
   lockKind, // Harness must observe pg_blocking_pids; do not require only advisory locks.
  });
  const waiterResult=result.waiter??result;return waiterResult;
 };
 if(runConcurrency){
  // Native runner must prove actual overlap for blocked:true. PGlite cannot do so.
  const mark=label=>{concurrencyPassed++;report(`PASS native concurrency: ${label}`);};
  let name=item('same request'),p=payload(name);
  await race(call(p),call(p),{lockKind:'advisory'});
  assert.equal(await factCount(name),1);dimensions(await balance(name),[10,2,20,1]);
  const conflict=await race(call(p),call({...p,quantity:11}),{succeeds:false,lockKind:'advisory'});
  assert.match(conflict.error,/23505[\s\S]*inventory_request_conflict/);assert.equal(await factCount(name),1);mark('duplicate request waits and changed payload has no second effect');

  name=item('two new inputs');p=payload(name);
  await race(call(p),call(payload(name,'inbound',4,{pallet_count:1,weight_kg:8,volume_m3:0.4})),{lockKind:'unique'});
  dimensions(await balance(name),[14,3,28,1.4]);assert.equal(await factCount(name),2);mark('two concurrent inputs create one balance with exact sums');

  name=item('existing input output');await rpc(payload(name));
  await race(call(payload(name,'inbound',4,{pallet_count:1,weight_kg:8,volume_m3:0.4})),call(payload(name,'outbound',3)));
  dimensions(await balance(name),[11,2,22,1.1]);assert.equal(await factCount(name),3);mark('input and output serialize on an existing balance');

  name=item('competing outputs');await rpc(payload(name,'inbound',5,{pallet_count:0,weight_kg:0,volume_m3:0}));
  const removal=()=>payload(name,'outbound',4,{pallet_count:0,weight_kg:0,volume_m3:0});
  const rejected=await race(call(removal()),call(removal()),{succeeds:false});
  assert.match(rejected.error,/23514[\s\S]*insufficient_inventory_balance/);
  dimensions(await balance(name),[1,0,0,0]);assert.equal(await factCount(name),2);mark('competing outputs recheck the committed locked balance');

  name=item('absent input output');const outbound=payload(name,'outbound',3);
  const missing=await race(call(payload(name)),call(outbound),{succeeds:false,blocked:false,lockKind:'none'});
  assert.match(missing.error,/23514[\s\S]*insufficient_inventory_balance/);assert.equal(await factCount(name),1);
  await rpc(outbound);dimensions(await balance(name),[7,1,14,0.7]);assert.equal(await factCount(name),2);
  mark('output against an uncommitted first input rejects then safely retries');

  name=item('revoked request waiter');p=payload(name);
  const lock=`select pg_advisory_xact_lock(hashtextextended(${q(`inventory-movement:${i.tenant}:${p.request_id}`)},0))`;
  try{
   const revoked=await race(lock,call(p),{succeeds:false,lockKind:'advisory',after:`reset role; update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.actor)}`});
   assert.match(revoked.error,/42501[\s\S]*inventory_not_authorized/);assert.equal(await factCount(name),0);
  }finally{await run(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.actor)}`);}
  mark('revocation while waiting on the real request lock rejects');

  name=item('duplicate outbound');await rpc(payload(name));p=payload(name,'outbound',3);
  await race(call(p),call(p),{lockKind:'advisory'});
  dimensions(await balance(name),[7,1,14,0.7]);assert.equal(await factCount(name),2);mark('duplicate outbound request deducts exactly once');
 }
 const concurrencyPending=runConcurrency?0:CONCURRENCY_CASES;
 if(concurrencyPending)report(`PENDING: ${concurrencyPending} native concurrency cases; sequential adapter is not native acceptance.`);
 return {sequentialPassed,concurrencyPassed,concurrencyPending,database,predecessorMd5:fixture.predecessorMd5,
  forwardSha256:createHash('sha256').update(forwardSql).digest('hex'),sources:fixture.sources,
  scope:'synthetic SQL contract; real JWT/PostgREST, full baseline/UI and A5 business acceptance remain separate'};
}

export {runStockBalanceBlockerCases as runInventoryOutbound};
