// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db:PGlite;
const tenant='00000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table clients(id uuid primary key,tenant_id uuid,company_name text);
 create table inventory_locations(id uuid primary key,tenant_id uuid,name text);
 create table inventory_balances(id uuid primary key,tenant_id uuid,client_id uuid,location_id uuid,item_description text,quantity numeric,first_inbound_at timestamptz);
 create table inventory_movements(id uuid primary key,tenant_id uuid,client_id uuid,location_id uuid,item_description text,movement_type text,moved_at timestamptz);`);
 await db.exec(readFileSync('supabase/migrations/20260921180910_search_inventory_relations.sql','utf8'));
 await db.query('insert into clients values($1,$2,$3)', ['00000000-0000-4000-8000-000000000010',tenant,'Cliente Alfa']);
 await db.query('insert into inventory_locations values($1,$2,$3)', ['00000000-0000-4000-8000-000000000011',tenant,'Galpão Azul']);
 await db.query(`insert into inventory_balances values($1,$2,$3,$4,'Parafusos',10,now()-interval '40 days')`,['00000000-0000-4000-8000-000000000020',tenant,'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011']);
 await db.query(`insert into inventory_movements values($1,$2,$3,$4,'Parafusos','inbound',now())`,['00000000-0000-4000-8000-000000000021',tenant,'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011']);
},30_000);
afterAll(async()=>db.close());

describe('inventory relational readers',()=>{
 it.each([['list_inventory_balances_page_v1','Cliente Alfa'],['list_inventory_balances_page_v1','Galpão Azul'],['list_inventory_movements_page_v1','Cliente Alfa'],['list_inventory_movements_page_v1','Galpão Azul']])('finds related labels through %s',async(fn,search)=>{
  const sql=fn.includes('balances')?`select ${fn}($1,$2) payload`:`select ${fn}($1,$2) payload`;
  const result=await db.query<{payload:{total:number}}>(sql,[tenant,search]);expect(result.rows[0].payload.total).toBe(1);
 });
 it('uses the tenant civil-day boundaries for timestamptz movements',async()=>{
  await db.query(`insert into inventory_movements values
   ('00000000-0000-4000-8000-000000000031',$1,null,null,'before','inbound','2026-09-16T02:59:59Z'),
   ('00000000-0000-4000-8000-000000000032',$1,null,null,'start','inbound','2026-09-16T03:00:00Z'),
   ('00000000-0000-4000-8000-000000000033',$1,null,null,'end','inbound','2026-09-17T02:59:59Z'),
   ('00000000-0000-4000-8000-000000000034',$1,null,null,'after','inbound','2026-09-17T03:00:00Z')`,[tenant]);
  const result=await db.query<{payload:{rows:Array<{item_description:string}>;total:number}}>(
   `select list_inventory_movements_page_v1($1,_from=>$2,_to=>$2,_timezone=>'America/Sao_Paulo') payload`,[tenant,'2026-09-16']);
  expect(result.rows[0].payload.rows.map(row=>row.item_description)).toEqual(['end','start']);
 });
});
