// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

let db:PGlite;
const tenant='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',request='00000000-0000-4000-8000-000000000003';
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql stable as $$select true$$;
 create table inventory_movements(id uuid primary key,tenant_id uuid,location_id uuid,movement_type text,adjustment_direction text,client_id uuid,item_description text,quantity numeric,pallet_count integer,weight_kg numeric,volume_m3 numeric,fiscal_document_id uuid,notes text,moved_at timestamptz,created_at timestamptz,created_by uuid);
 create table effects(n integer not null);insert into effects values(0);
 create function count_effect() returns trigger language plpgsql as $$begin update public.effects set n=n+1;return new;end$$;
 create trigger movement_effect after insert on inventory_movements for each row execute function count_effect();`);
 await db.exec(readFileSync('supabase/migrations/20260921182102_idempotent_inventory_movements.sql','utf8'));
},30_000);
afterAll(async()=>db.close());

describe('idempotent inventory movement database command',()=>{
 it('returns the original movement and fires its effect only once',async()=>{
  const payload={tenant_id:tenant,request_id:request,movement_type:'inbound',item_description:'Caixa',quantity:2,pallet_count:1};
  const first=await db.query<{v:{id:string}}>('select create_inventory_movement_v1($1) v',[payload]);
  const second=await db.query<{v:{id:string}}>('select create_inventory_movement_v1($1) v',[payload]);
  expect(second.rows[0].v.id).toBe(first.rows[0].v.id);
  expect((await db.query<{n:number}>('select n from effects')).rows[0].n).toBe(1);
 });
});
