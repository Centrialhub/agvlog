// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';

let db:PGlite;
const tenant=randomUUID(),scope=randomUUID();

beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`
  create schema finance_private;
  create role anon;create role authenticated;create role service_role;
  ${['maintenance_orders','finance_expense_items','finance_expense_batches','clients','finance_maintenance_labor_links','finance_maintenance_labor_reversals','maintenance_parts','finance_maintenance_direct_part_links','finance_maintenance_direct_part_reversals','stock_movements','stock_items','finance_stock_acquisition_links','finance_stock_acquisition_reversals','finance_stock_acquisition_dependencies','finance_stock_consumption_attributions','finance_stock_consumption_lines','finance_stock_consumption_reversals'].map(name=>`create table ${name}(id uuid default gen_random_uuid(),tenant_id uuid not null);`).join('\n')}
  create function finance_private.maintenance_labor_context(uuid,uuid,integer,text) returns jsonb language sql stable as $$select jsonb_build_object('kind','labor')$$;
  create function finance_private.maintenance_direct_part_context(uuid,uuid,integer,text) returns jsonb language sql stable as $$select jsonb_build_object('kind','part')$$;
  create function finance_private.stock_acquisition_context(uuid,uuid,integer,text) returns jsonb language sql stable as $$select jsonb_build_object('kind','acquisition')$$;
  create function finance_private.stock_consumption_context(uuid,uuid,uuid,integer,text) returns jsonb language sql stable as $$select jsonb_build_object('kind','consumption')$$;
  create function public.get_finance_maintenance_labor_context(uuid,uuid,integer default 1,text default '') returns jsonb language sql as $$select '{}'::jsonb$$;
  create function public.get_finance_maintenance_direct_part_context(uuid,uuid,integer default 1,text default '') returns jsonb language sql as $$select '{}'::jsonb$$;
  create function public.get_finance_stock_acquisition_context(uuid,uuid,integer default 1,text default '') returns jsonb language sql as $$select '{}'::jsonb$$;
  create function public.get_finance_stock_consumption_context(uuid,uuid,uuid,integer default 1,text default '') returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 await db.exec(readFileSync('supabase/migrations/20260917081032_stabilize_cost_association_paging.sql','utf8'));
},30000);

afterAll(async()=>{await db?.close();});

it('pins every association reader to the first-page revision',async()=>{
 const readers=[
  ['get_finance_maintenance_labor_context',[tenant,scope,1,'',null]],
  ['get_finance_maintenance_direct_part_context',[tenant,scope,1,'',null]],
  ['get_finance_stock_acquisition_context',[tenant,scope,1,'',null]],
  ['get_finance_stock_consumption_context',[tenant,scope,scope,1,'',null]],
 ] as const;
 for(const [name,args] of readers){
  const placeholders=args.map((_,index)=>`$${index+1}`).join(',');
  const first=(await db.query<{v:{revision:string}}>(`select ${name}(${placeholders}) v`,[...args])).rows[0].v;
  expect(first.revision).toMatch(/^[a-f0-9]{32}$/);
  await db.query('insert into clients(tenant_id) values($1)',[tenant]);
  await expect(db.query(`select ${name}(${placeholders}) v`,[...args.slice(0,-1),first.revision])).rejects.toThrow('finance_page_changed');
 }
});

it('removes the unversioned public overloads and keeps the new RPC private from anon',async()=>{
 const result=await db.query<{old_missing:boolean;authenticated:boolean;anonymous:boolean}>(`
  select
   to_regprocedure('public.get_finance_maintenance_labor_context(uuid,uuid,integer,text)') is null old_missing,
   has_function_privilege('authenticated','public.get_finance_maintenance_labor_context(uuid,uuid,integer,text,text)','execute') authenticated,
   has_function_privilege('anon','public.get_finance_maintenance_labor_context(uuid,uuid,integer,text,text)','execute') anonymous
 `);
 expect(result.rows[0]).toEqual({old_missing:true,authenticated:true,anonymous:false});
});
