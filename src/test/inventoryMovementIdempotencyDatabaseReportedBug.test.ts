// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

let db:PGlite;
const tenant='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',request='00000000-0000-4000-8000-000000000003';
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$
   select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.is_tenant_admin(t uuid) returns boolean language sql stable as $$
   select t='${tenant}'::uuid and auth.uid()='${actor}'::uuid$$;
 create table clients(id uuid primary key,tenant_id uuid,company_name text);
 create table inventory_locations(id uuid primary key,tenant_id uuid,name text);
 create table inventory_balances(id uuid primary key,tenant_id uuid,client_id uuid,location_id uuid,item_description text,quantity numeric,first_inbound_at timestamptz);
 create table inventory_movements(id uuid primary key,tenant_id uuid,location_id uuid,movement_type text,adjustment_direction text,client_id uuid,item_description text,quantity numeric,pallet_count integer,weight_kg numeric,volume_m3 numeric,fiscal_document_id uuid,notes text,moved_at timestamptz,created_at timestamptz,created_by uuid);
 create table effects(n integer not null);insert into effects values(0);
 create function count_effect() returns trigger language plpgsql as $$begin update public.effects set n=n+1;return new;end$$;
 create trigger movement_effect after insert on inventory_movements for each row execute function count_effect();`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 await db.exec(readFileSync('supabase/migrations/20260926190732_restore_inventory_public_rpcs.sql','utf8'));
},30_000);
afterAll(async()=>db.close());

async function createMovement(payload:Record<string,unknown>){
 await db.exec('set role authenticated');
 try{return await db.query<{v:{id:string}}>('select public.create_inventory_movement_v1($1) v',[payload]);}
 finally{await db.exec('reset role');}
}

describe('idempotent inventory movement database command',()=>{
 it('returns the original movement and fires its effect only once',async()=>{
  const payload={tenant_id:tenant,request_id:request,movement_type:'inbound',item_description:'Caixa',quantity:2,pallet_count:1};
  const first=await createMovement(payload);
  const second=await createMovement(payload);
  expect(second.rows[0].v.id).toBe(first.rows[0].v.id);
  expect((await db.query<{n:number}>('select n from effects')).rows[0].n).toBe(1);
 });

 it('rejects a changed retry without creating another movement or balance effect',async()=>{
  await expect(createMovement({tenant_id:tenant,request_id:request,movement_type:'inbound',
    item_description:'Caixa',quantity:3,pallet_count:1})).rejects.toThrow('inventory_request_conflict');
  expect((await db.query<{n:number}>('select n from effects')).rows[0].n).toBe(1);
  expect((await db.query<{n:number}>('select count(*)::int n from inventory_movements')).rows[0].n).toBe(1);
 });

 it('rejects a different actor or tenant before applying an inventory effect',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-000000000004']);
  try{
   await expect(createMovement({tenant_id:tenant,request_id:'00000000-0000-4000-8000-000000000005',
     movement_type:'inbound',item_description:'Caixa',quantity:1})).rejects.toThrow('inventory_not_authorized');
  }finally{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);}
  await expect(createMovement({tenant_id:'00000000-0000-4000-8000-000000000006',
    request_id:'00000000-0000-4000-8000-000000000007',movement_type:'inbound',
    item_description:'Caixa',quantity:1})).rejects.toThrow('inventory_not_authorized');
  expect((await db.query<{n:number}>('select n from effects')).rows[0].n).toBe(1);
 });
});
