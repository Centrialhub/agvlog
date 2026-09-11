import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const versions=['20260830080608','20260830085557','20260830094049','20260830102652'];
const predicates=versions.map(v=>{const f=fs.readdirSync('supabase/migrations').find(x=>x.startsWith(v));const sql=fs.readFileSync('supabase/migrations/'+f,'utf8');const start=sql.indexOf("exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass");const end=sql.indexOf('),false))',start)+10;assert.ok(start>0&&end>start);return sql.slice(start,end);});
const cases=[
 ['no workspace policy (fresh chain)',null,false],
 ['exact restrictive authenticated workspace policy',"as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id))",false],
 ['permissive workspace policy',"as permissive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id))",true],
 ['changed USING',"as restrictive for all to authenticated using(true) with check(private.is_request_tenant_member(tenant_id))",true],
 ['changed WITH CHECK',"as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(true)",true],
 ['changed role',"as restrictive for all to public using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id))",true],
 ['changed command SELECT',"as restrictive for select to authenticated using(private.is_request_tenant_member(tenant_id))",true],
 ['absent WITH CHECK',"as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id))",true],
];
test('four migrations carry the same narrowly scoped guard',()=>{for(const p of predicates)assert.equal(p,predicates[0]);});
for(const [name,policy,rejected] of cases)test(name,async()=>{const db=new PGlite();try{
 await db.exec(`create role authenticated;create schema private;create table public.idempotency_keys(tenant_id uuid);alter table public.idempotency_keys enable row level security;create function private.is_request_tenant_member(uuid) returns boolean language sql as 'select false';create policy old_read on public.idempotency_keys for select to authenticated using(false);`);
 if(policy)await db.exec(`create policy agvlog_active_tenant_context on public.idempotency_keys ${policy}`);
 const result=await db.query(`select ${predicates[0]} as rejected`);assert.equal(result.rows[0].rejected,rejected);
 if(!rejected){await db.exec('create policy unexpected_writer on public.idempotency_keys for insert to authenticated with check(true)');const blocked=await db.query(`select ${predicates[0]} as rejected`);assert.equal(blocked.rows[0].rejected,true);}
 }finally{await db.close();}});
