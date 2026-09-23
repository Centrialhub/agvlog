// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {createCanonicalCompanyCompatibilityDatabase} from './helpers/canonicalCompanyCompatibilityDatabase';
const opened:Array<Awaited<ReturnType<typeof createCanonicalCompanyCompatibilityDatabase>>>=[];
const original=readFileSync('supabase/migrations/20260910211000_canonical_destination_geocoding_idempotency.sql','utf8');
const compatible=readFileSync('supabase/rollouts/20260911032601_canonical_destination_geocoding_policy_compat.sql','utf8');
const assistedCandidateValidation=readFileSync('supabase/migrations/20260922016000_validate_assisted_address_candidate.sql','utf8');
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',actor='20000000-0000-4000-8000-000000000001',stop='30000000-0000-4000-8000-000000000001';
async function fixture(){const db=await createCanonicalCompanyCompatibilityDatabase();opened.push(db);return db;}
async function claim(db:typeof opened[number],tenant:string,header=tenant){await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",[actor,JSON.stringify({role:'authenticated',active_tenant_id:tenant}),JSON.stringify({'x-agvlog-tenant-id':header})]);}
async function call(db:typeof opened[number],sql:string,args:unknown[]=[]){await db.exec('savepoint call;set role authenticated');try{const out=await db.query(sql,args);await db.exec('reset role;release savepoint call');return out;}catch(e){await db.exec('rollback to savepoint call');throw e;}}
afterEach(async()=>{for(const db of opened.splice(0)){await db.exec('rollback');await db.close();}});
it('reproduces the original postcondition failure and installs compatible full SQL preserving seven policies',async()=>{const db=await fixture();await db.exec('savepoint original');await expect(db.exec(original)).rejects.toThrow('canonical_destination_geocoding_idempotency_postcondition_failed');await db.exec('rollback to savepoint original');await db.exec(compatible);expect((await db.query("select count(*)::int n from pg_policy where polname like 'agvlog_%' and polrelid in('geofences'::regclass,'geofence_radius_policies'::regclass,'address_resolution_queue'::regclass)")).rows[0]).toEqual({n:7});});
it('uses current claim checks for direct RLS and real destination resolution with exact replay',async()=>{const db=await fixture();await db.exec(compatible);await db.query('insert into tenants values($1),($2)',[a,b]);await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into tenant_memberships values($1,$3,true,'admin'),($2,$3,true,'admin')",[a,b,actor]);await db.query("insert into geofences(tenant_id,name) values($1,'A'),($2,'B')",[a,b]);await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,destination) values($1,$2,gen_random_uuid(),'Rua Teste, 123, Sao Paulo, SP')",[stop,a]);await claim(db,a);expect((await call(db,'select name from geofences')).rows).toEqual([{name:'A'}]);
 const queue=(await db.query<{id:string}>('select id from address_resolution_queue where tenant_id=$1',[a])).rows[0].id;const p={tenant_id:a,request_id:'50000000-0000-4000-8000-000000000001',queue_id:queue,latitude:-23.55,longitude:-46.63,provider:'qa-existing-result',accuracy_m:20,confidence:0.95,selection_kind:'assisted_candidate'};const sql='select resolve_address_queue_item_v2($1::jsonb) result';const result=(await call(db,sql,[JSON.stringify(p)])).rows;expect((await call(db,sql,[JSON.stringify(p)])).rows).toEqual(result);await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[a,actor]);await expect(call(db,sql,[JSON.stringify(p)])).rejects.toMatchObject({code:'42501'});await db.query('update tenant_memberships set active=true where tenant_id=$1 and user_id=$2',[a,actor]);await claim(db,b);expect((await call(db,'select name from geofences')).rows).toEqual([{name:'B'}]);await expect(call(db,sql,[JSON.stringify(p)])).rejects.toMatchObject({code:'42501'});await expect(call(db,'insert into geofences(tenant_id,name) values($1,$2)',[a,'wrong'])).rejects.toMatchObject({code:'42501'});await claim(db,a,b);await expect(call(db,'select name from geofences')).rejects.toMatchObject({code:'42501'});
});
it('rejects changed restrictive isolation and unknown extra policies with atomic rollback',async()=>{const db=await fixture();await db.exec('savepoint drift;alter policy agvlog_active_tenant_context on geofences using(true)');await expect(db.exec(compatible)).rejects.toThrow('canonical_company_policy_contract_changed');await db.exec('rollback to savepoint drift');await db.exec('savepoint extra;create policy unknown_extra on geofences for select to authenticated using(true)');await expect(db.exec(compatible)).rejects.toThrow('canonical_destination_geocoding_idempotency_postcondition_failed');await db.exec('rollback to savepoint extra');expect((await db.query("select to_regclass('public.canonical_addresses') value")).rows[0]).toEqual({value:null});});

it('places current authorization after every command wait and before every replay',async()=>{
 const db=await fixture();await db.exec(compatible);
 const bodies=(await db.query<{proname:string,prosrc:string}>("select proname,prosrc from pg_proc where pronamespace='private'::regnamespace and proname in('resolve_address_queue_item_v2','upsert_geofence_v4','review_trip_cargo_divergence_v2')")).rows;
 expect(bodies).toHaveLength(3);
 for(const {prosrc} of bodies){const wait=prosrc.indexOf('perform pg_advisory_xact_lock');const replay=prosrc.indexOf('return v_existing.response');const check=prosrc.indexOf('auth.uid() is distinct from v_actor',wait);expect(check).toBeGreaterThan(wait);expect(check).toBeLessThan(replay);expect(prosrc.lastIndexOf('auth.uid() is distinct from v_actor')).toBeLessThan(prosrc.indexOf('insert into public.operator_command_ledger'));}
 const resolve=bodies.find(x=>x.proname==='resolve_address_queue_item_v2')!.prosrc;
 expect(resolve.indexOf('auth.uid() is distinct from v_actor',resolve.indexOf('for update;'))).toBeLessThan(resolve.indexOf('update public.canonical_addresses'));
});

it('accepts only an assisted selection that exactly matches a locked queue candidate',async()=>{
 const db=await fixture();await db.exec(compatible);await db.exec(assistedCandidateValidation);
 await db.query('insert into tenants values($1)',[a]);await db.query('insert into auth.users values($1)',[actor]);
 await db.query("insert into tenant_memberships values($1,$2,true,'admin')",[a,actor]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,destination) values($1,$2,gen_random_uuid(),'Rua Teste, 123, Sao Paulo, SP')",[stop,a]);
 const queue=(await db.query<{id:string}>('select id from address_resolution_queue where tenant_id=$1',[a])).rows[0].id;
 const candidate={label:'Endereco QA',latitude:-23.55,longitude:-46.63,provider:'qa-existing-result',accuracy_m:20,confidence:0.95};
 await db.query('update address_resolution_queue set candidates=$2::jsonb where id=$1',[queue,JSON.stringify([candidate])]);
 await claim(db,a);
 const payload={tenant_id:a,request_id:'50000000-0000-4000-8000-000000000010',queue_id:queue,
   ...candidate,selection_kind:'assisted_candidate'};
 await expect(call(db,'select resolve_address_queue_item_v2($1::jsonb)',[JSON.stringify({...payload,
   request_id:'50000000-0000-4000-8000-000000000011',provider:'invented'})])).rejects.toMatchObject({code:'22023'});
 const result=(await call(db,'select resolve_address_queue_item_v2($1::jsonb) result',[JSON.stringify(payload)])).rows[0];
 expect(result).toHaveProperty('result.ok',true);
});
