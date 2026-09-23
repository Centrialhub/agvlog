// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db:PGlite;
const tenant='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002';
beforeAll(async()=>{
  db=new PGlite();await db.exec(`create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create function public.is_tenant_member(t uuid) returns boolean language sql stable as $$select true$$;
  create table clients(id uuid primary key,tenant_id uuid,company_name text);
  create table inventory_balances(id uuid primary key,tenant_id uuid,client_id uuid,pallet_count numeric,quantity numeric,first_inbound_at timestamptz);`);
  await db.exec(readFileSync('supabase/migrations/20260921191442_exclude_nonpositive_inventory_summary.sql','utf8'));
  await db.query(`insert into inventory_balances values
    ('00000000-0000-4000-8000-000000000010',$1,null,7,1,now()-interval '40 days'),
    ('00000000-0000-4000-8000-000000000011',$1,null,99,0,now()-interval '40 days'),
    ('00000000-0000-4000-8000-000000000012',$1,null,88,-1,now()-interval '40 days')`,[tenant]);
  await db.query("select set_config('app.uid',$1,false)",[actor]);
},30000);
afterAll(async()=>db?.close());

describe('inventory summary positive balances',()=>{
  it('excludes zero and negative balances from every headline KPI',async()=>{
    const result=await db.query<{value:{balance_count:number;total_pallets:number;stagnant_count:number}}>('select get_inventory_summary_v1($1) value',[tenant]);
    expect(result.rows[0].value).toMatchObject({balance_count:1,total_pallets:7,stagnant_count:1});
  });
});
