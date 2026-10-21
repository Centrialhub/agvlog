// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, it } from 'vitest';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

type QueueState = {
  attempts: number; last_error: string | null; lease_token: string | null;
  next_attempt_at: Date; status: string;
};
type WorkerResult = { success: boolean; results: Array<{error?: string}> };
type WorkerHandler = (request: Request) => Promise<Response>;
type MockFetch = (url: string, options?: RequestInit) => Promise<Response>;
const root=process.cwd();
const workerPath='supabase/functions/process-address-resolution-queue/index.ts';
const historicalWorker=(file:string,expectedHash:string)=>{
  const text=readFileSync(`${root}/src/test/fixtures/history/${file}`,'utf8').replace(/\r\n/g,'\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),expectedHash,'Historical address worker fixture changed');
  return text;
};
const originalWorker=historicalWorker('address-worker-0cfa824.fixture.txt','04e5a1d743a8565322c00fa99a367e5333852dfee5bed0db778310907248e1b1');
const worker=readFileSync(`${root}/${workerPath}`,'utf8');
const beforeWorker=historicalWorker('address-worker-6f6361c.fixture.txt','b8ea226e542ba4fff626186a025b2063c4cbcb19d9126b2cb4baa612e0f786dc');
const migration=readFileSync(`${root}/supabase/migrations/20260916152615_finalize_geofence_automation.sql`,'utf8').replace(/\r\n/g,'\n');
const ackSql=migration.match(/create or replace function public\.ack_address_resolution_queue_item_v2\(_payload jsonb\)[\s\S]*?grant execute on function public\.ack_address_resolution_queue_item_v2\(jsonb\) to service_role;/)?.[0];
const fixture=readFileSync(`${root}/src/test/processAddressResolutionQueueErrorAck.test.ts`,'utf8');
const setup=fixture.match(/beforeAll\(async \(\) => \{[\s\S]*?await db\.exec\(`([\s\S]*?)`\);/)?.[1];
const seedTemplate=fixture.match(/beforeEach\(async \(\) => \{[\s\S]*?await db\.exec\(`([\s\S]*?)`\);/)?.[1];
assert.ok(ackSql&&setup&&seedTemplate);
const values={tenant:'71000000-0000-4000-8000-000000000001',otherTenant:'71000000-0000-4000-8000-000000000002',
  queueId:'72000000-0000-4000-8000-000000000001',clientId:'73000000-0000-4000-8000-000000000001',
  canonicalId:'74000000-0000-4000-8000-000000000001',lease:'75000000-0000-4000-8000-000000000001',addressHash:'c'.repeat(64)};
const seedSql=seedTemplate.replace(/\$\{([a-zA-Z]+)\}/g,(_m:string,key:string)=>{assert.ok(key in values);return values[key as keyof typeof values];});
const claimed={id:values.queueId,tenant_id:values.tenant,entity_type:'client',entity_id:values.clientId,
  address_snapshot:'Own synthetic address',address_hash:values.addressHash,lease_token:values.lease,attempts:2};
const db=new PGlite(); const errors: Array<{code?:string,message:string}>=[]; let requests=0,acks: Array<Record<string,unknown>>=[],ackUnavailable=false;
const queue=async()=>(await db.query<QueueState>('select * from public.address_resolution_queue where id=$1',[values.queueId])).rows[0];
const reset=async()=>{await db.exec(seedSql);acks=[];errors.length=0;requests=0;ackUnavailable=false;};
const mockClient={rpc:(name:string,args:{_payload?:Record<string,unknown>})=>{
  const result=(async()=>{
  if(name==='claim_address_resolution_queue_v2')return {data:[claimed],error:null};
  assert.equal(name,'ack_address_resolution_queue_item_v2');
  assert.ok(args._payload);const payload:Record<string,unknown>=JSON.parse(JSON.stringify(args._payload)); acks.push(payload);
  if(ackUnavailable)return {data:null,error:{message:'SYNTHETIC_ACK_UNAVAILABLE'}};
  try{return {data:(await db.query<{result:unknown}>('select public.ack_address_resolution_queue_item_v2($1::jsonb) result',
    [JSON.stringify(payload)])).rows[0].result,error:null};}
  catch(error){const failure=error instanceof Error?error:new Error(String(error));const code='code' in failure&&typeof failure.code==='string'?failure.code:undefined;errors.push({code,message:failure.message});return {data:null,error};}
  })();return Object.assign(result,{abortSignal:(_signal:AbortSignal)=>result});
}};
const makeHandler=(source:string,mockFetch:MockFetch)=>{
  let handler:WorkerHandler|undefined;
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
    .outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export \{\};?\r?\n?/gm,'');
  const env:Record<string,string|undefined>={SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC_SERVICE',
    SUPABASE_ANON_KEY:'SYNTHETIC_ANON',GEOCODING_PROVIDER:'fixture'};
  vm.runInNewContext(js,{createClient:()=>mockClient,corsHeaders:{},isCronRequest:async()=>true,
    Deno:{env:{get:(key:string)=>env[key]},serve:(fn:WorkerHandler)=>{handler=fn;}},Response,Request,
    fetch:async(url:string,options?:RequestInit)=>{assert.equal(url,'https://db.example.test/functions/v1/geocode-address');
      requests++;return mockFetch(url,options);},setTimeout,clearTimeout,AbortController});
  assert.equal(typeof handler,'function');assert.ok(handler);return handler;
};
const invoke=async(source:string,mockFetch:MockFetch)=>{
  const response=await makeHandler(source,mockFetch)(new Request('https://worker.example.test',{
    method:'POST',headers:{'x-agvlog-cron-secret':'SYNTHETIC_ONLY','Content-Type':'application/json'},
    body:JSON.stringify({limit:1})}));
  return {status:response.status,body:await response.json() as WorkerResult};
};
const response=(body:unknown,status=200)=>async()=>new Response(JSON.stringify(body),{status});
const test=(name:string,run:()=>Promise<void>)=>{it(name,async()=>{await reset();await run();});};
const candidate={latitude:-19.9,longitude:-43.9,provider:'fixture',accuracy_m:50,confidence:0.9};
beforeAll(async()=>{await db.exec(setup);await db.exec(ackSql);
  const containment = readFileSync('supabase/migrations/20261009151836_address_queue_business_errors_no_serialization_retry.sql', 'utf8');
  const claimedRpc = containment.match(/CREATE OR REPLACE FUNCTION public\.get_claimed_address_resolution_item_v1[\s\S]*?\$function\$ ;/)?.[0];
  if (!claimedRpc) throw new Error('Contained get-claimed definition missing');
  const containedAck = containment.match(/CREATE OR REPLACE FUNCTION public\.ack_address_resolution_queue_item_v2[\s\S]*?\$function\$ ;/)?.[0];
  if (!containedAck) throw new Error("Contained ACK definition missing");
  await db.exec(containedAck);
  await db.exec(claimedRpc);
  await db.exec('revoke all on function public.get_claimed_address_resolution_item_v1(uuid,uuid) from public,anon,authenticated,service_role; grant execute on function public.get_claimed_address_resolution_item_v1(uuid,uuid) to service_role;');
  await db.exec(containment);
},30000);
afterAll(async()=>{await db.close();});
  await test('before-fix HTTP502 sends JSON null and SQL rejects22023 without release',async()=>{
    assert.equal((await invoke(beforeWorker,response({error:'provider_failed'},502))).body.success,false);
    assert.equal(acks[0].candidates,null);assert.deepEqual(errors,[{code:'22023',message:'invalid_geocoding_candidates'}]);
    assert.equal((await queue()).attempts,2);assert.equal((await queue()).lease_token,values.lease);
  });
  await test('fixed HTTP502 retains original error, increments attempts and releases lease',async()=>{
    const initial=await queue();assert.equal((await invoke(worker,response({error:'provider_failed'},502))).body.success,true);
    const state=await queue();assert.deepEqual(acks[0].candidates,[]);assert.equal(acks[0].error,'provider_failed');
    assert.equal(state.attempts,3);assert.equal(state.last_error,'provider_failed');assert.equal(state.lease_token,null);
    assert.ok(Number(state.next_attempt_at)-Number(initial.next_attempt_at)>=480000);
  });
  await test('non2xx candidate array is discarded while explicit failure is retained',async()=>{
    assert.equal((await invoke(worker,response({candidates:[candidate],error:'rate_limited',retry_after_ms:900000},429))).body.success,true);
    assert.deepEqual(acks[0].candidates,[]);assert.equal(acks[0].error,'rate_limited');
    assert.equal((await queue()).status,'error');assert.equal((await queue()).last_error,'rate_limited');
  });
  await test('thrown non-Error transport value is ACKed with geocoder_unreachable',async()=>{
    assert.equal((await invoke(worker,async()=>{throw 'synthetic';})).body.success,true);
    assert.equal(acks[0].error,'geocoder_unreachable');assert.equal((await queue()).lease_token,null);
  });
  await test('204 with no JSON body records failure and clears lease',async()=>{
    assert.equal((await invoke(worker,async()=>new Response(null,{status:204}))).body.success,true);
    assert.equal(acks[0].error,'geocode_http_204');assert.equal((await queue()).lease_token,null);
  });
  for(const body of [42,[], 'unexpected'])await test(`nonobject JSON ${JSON.stringify(body)} is ACKed as missing candidates`,async()=>{
    assert.equal((await invoke(worker,response(body))).body.success,true);assert.deepEqual(acks[0].candidates,[]);
    assert.equal(acks[0].error,'invalid_geocoder_response');assert.equal((await queue()).attempts,3);
  });
  for(const [name,source] of [['base',beforeWorker],['prior0cfa',originalWorker]])await test(`${name}: JSON null root throws before ACK (preexisting boundary)`,async()=>{
    const initial=await queue();await assert.rejects(()=>invoke(source,response(null)),error=>typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'&&/null/.test(error.message));
    assert.equal(requests,1);assert.equal(acks.length,0);assert.deepEqual(await queue(),initial);
  });
  for(const body of [null,false,0,[], 'unexpected'])await test('guarded root '+JSON.stringify(body)+' ACKs explicit error without losing lease',async()=>{
    const initial=await queue();const result=await invoke(worker,response(body));
    assert.equal(result.body.success,true);assert.equal(acks.length,1);
    assert.deepEqual(acks[0].candidates,[]);assert.equal(acks[0].error,'invalid_geocoder_response');
    const state=await queue();assert.equal(state.attempts,3);assert.equal(state.last_error,'invalid_geocoder_response');
    assert.equal(state.lease_token,null);assert.ok(Number(state.next_attempt_at)-Number(initial.next_attempt_at)>=480000);
  });
  await test('ACK transport failure reports failure without claiming attempts or release',async()=>{
    ackUnavailable=true;const initial=await queue();const result=await invoke(worker,response({error:'provider_failed'},502));
    assert.equal(result.body.success,false);assert.equal(result.body.results[0].error,'address_queue_ack_failed');
    assert.deepEqual(acks[0].candidates,[]);assert.equal(acks[0].error,'provider_failed');assert.deepEqual(await queue(),initial);
  });
  for(const [name,update,message] of [
    ['expired lease',"lease_expires_at=clock_timestamp()-interval '1 second'",'address_queue_lease_lost'],
    ['replaced owner',"lease_token='75000000-0000-4000-8000-000000000099'",'address_queue_lease_lost'],
    ['changed address hash',"address_hash=repeat('d',64)",'address_queue_hash_changed'],
  ])await test(`worker failure ACK cannot bypass ${name}`,async()=>{
    let expected;
    const result=await invoke(worker,async()=>{
      await db.query(`update public.address_resolution_queue set ${update} where id=$1`,[values.queueId]);
      expected=await queue();return new Response(JSON.stringify({error:'provider_failed'}),{status:502});});
    assert.equal(result.body.success,false);assert.deepEqual(errors,[{code:'P0001',message}]);
    assert.deepEqual(await queue(),expected);
  });
  await test('successful [] keeps error=null then SQL records no_candidates',async()=>{
    assert.equal((await invoke(worker,response({candidates:[]}))).body.success,true);
    assert.equal(acks[0].error,null);assert.equal((await queue()).last_error,'no_candidates');
  });
  await test('valid successful candidate still resolves',async()=>{
    assert.equal((await invoke(worker,response({candidates:[candidate]}))).body.success,true);
    assert.deepEqual(acks[0].candidates,[candidate]);assert.equal(acks[0].error,null);
    assert.equal((await queue()).status,'resolved');
  });
