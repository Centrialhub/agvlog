// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenant='20000000-0000-4000-8000-000000000081';
const trip='80000000-0000-4000-8000-000000000081';
const control='81000000-0000-4000-8000-000000000081';
const driver='60000000-0000-4000-8000-000000000081';
const actor='10000000-0000-4000-8000-000000000081';
let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema finance_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select jsonb_build_object('role',coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated'))$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.active_tenant',true),'')::uuid$$;
    create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text,
      actual_end_at timestamptz,planned_start_at timestamptz);
    create table trip_cargo_controls(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text,
      closed_at timestamptz);
    create table driver_settlements(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,status text default 'pending_review',loads_count integer default 1,
      documents_count integer default 1,estimated_km numeric default 1,total_invoice_value numeric default 1,
      total_freight_value numeric default 1,needs_recalculation boolean default false,last_recalculated_at timestamptz default now(),
      unique(tenant_id,dispatch_trip_id));
    create table finance_expense_batches(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      context text,trip_id uuid);
    create table driver_expenses(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,description text);
    create table finance_movements(id uuid primary key,tenant_id uuid,beneficiary_name text,occurred_on date,
      bank_reference text,description text,amount_cents bigint,driver_id uuid,direction text,nature text);
    create table finance_expense_allocations(tenant_id uuid,movement_id uuid,amount_cents bigint);
    create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
    create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
    create table drivers(id uuid primary key,tenant_id uuid,name text);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,destination text);
    create table physical_journeys(id uuid primary key,status text,actual_end_at timestamptz,updated_at timestamptz);
    create table physical_journey_trips(physical_journey_id uuid,dispatch_trip_id uuid);
    create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,new_data jsonb);
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select true$$;
    create function finance_private.can_access(uuid) returns boolean language sql stable as
      $$select coalesce(nullif(current_setting('test.finance_access',true),''),'true')::boolean$$;
    create function finance_private.require_access(uuid) returns void language plpgsql stable as $$begin
      if not finance_private.can_access($1) then raise exception 'finance_access_denied' using errcode='42501';end if;end$$;
    create function finance_private.delivery_context(uuid,uuid) returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.audit_log(tenant_id,entity_type,entity_id,action,new_data) values($1,$2,$3,$4,$6)$$;
    create function public._build_driver_settlement(uuid,uuid) returns uuid language plpgsql as $$
      declare result uuid;begin insert into public.driver_settlements(tenant_id,dispatch_trip_id)
      values($1,$2) on conflict(tenant_id,dispatch_trip_id) do update set last_recalculated_at=clock_timestamp()
      returning id into result;return result;end$$;
    insert into auth.users values('${actor}');
    insert into drivers values('${driver}','${tenant}','Motorista');
    insert into dispatch_trips values('${trip}','${tenant}','${driver}','completed',clock_timestamp(),clock_timestamp());
    insert into trip_cargo_controls values('${control}','${tenant}','${trip}','returned',null);
    insert into physical_journeys values('${trip}','active',null,clock_timestamp());
    insert into physical_journey_trips values('${trip}','${trip}');
    select set_config('request.jwt.claim.sub','${actor}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    select set_config('test.active_tenant','${tenant}',false);
    select set_config('test.finance_access','true',false);
  `);
  await db.exec(readFileSync('supabase/migrations/20260910211800_canonical_trip_cargo_close_gate.sql','utf8'));
},30_000);

afterAll(async()=>db?.close());

describe('canonical cargo-closed downstream gate executed by PostgreSQL',()=>{
  it('does not treat route completion as financial custody completion',async()=>{
    await db.query("insert into driver_expenses(tenant_id,dispatch_trip_id,description) values($1,$2,'Pedágio em rota')",[tenant,trip]);
    expect((await db.query('select count(*)::int count from driver_expenses')).rows).toEqual([{count:1}]);
    await db.query("insert into finance_expense_batches(tenant_id,context,trip_id) values($1,'office',null)",[tenant]);
    const hidden=(await db.query<{result:{total:number;rows:unknown[]}}>(
      "select finance_private.expense_options($1,'trips','',null,1) result",[tenant])).rows[0].result;
    expect(hidden).toMatchObject({total:0,rows:[]});
    await db.query("select set_config('test.finance_access','false',false)");
    await expect(db.query('select generate_driver_settlement($1,$2)',[tenant,trip])).rejects.toThrow('finance_access_denied');
    await db.query("select set_config('test.finance_access','true',false)");
    await expect(db.query('select generate_driver_settlement($1,$2)',[tenant,trip])).rejects.toThrow('trip_cargo_not_closed');
    await expect(db.query("insert into finance_expense_batches(tenant_id,context,trip_id) values($1,'trip',$2)",[tenant,trip]))
      .rejects.toThrow('trip_cargo_not_closed');
    await expect(db.query('insert into driver_settlements(tenant_id,dispatch_trip_id) values($1,$2)',[tenant,trip]))
      .rejects.toThrow('trip_cargo_not_closed');
    expect((await db.query('select count(*)::int count from driver_settlements')).rows).toEqual([{count:0}]);
  });

  it('releases operations and finance once, atomically, when cargo closes',async()=>{
    expect((await db.query<{allowed:boolean}>("select has_function_privilege('service_role','public.generate_driver_settlement(uuid,uuid)','execute') allowed")).rows)
      .toEqual([{allowed:true}]);
    expect((await db.query<{allowed:boolean}>("select has_function_privilege('service_role','public.generate_pending_driver_settlements(uuid)','execute') allowed")).rows)
      .toEqual([{allowed:true}]);
    await db.query("update trip_cargo_controls set status='closed',closed_at=clock_timestamp() where id=$1",[control]);
    expect((await db.query('select count(*)::int count from driver_settlements')).rows).toEqual([{count:1}]);
    expect((await db.query('select status from physical_journeys where id=$1',[trip])).rows).toEqual([{status:'completed'}]);
    expect((await db.query("select count(*)::int count from audit_log where action='downstream_released'")).rows).toEqual([{count:1}]);
    const released=(await db.query<{result:{total:number;rows:Array<{id:string}>}}>(
      "select finance_private.expense_options($1,'trips','',null,1) result",[tenant])).rows[0].result;
    expect(released).toMatchObject({total:1,rows:[{id:trip}]});
    await db.query("insert into finance_expense_batches(tenant_id,context,trip_id) values($1,'trip',$2)",[tenant,trip]);
    await db.query("update trip_cargo_controls set closed_at=closed_at where id=$1",[control]);
    expect((await db.query('select count(*)::int count from driver_settlements')).rows).toEqual([{count:1}]);
    expect((await db.query('select count(*)::int count from finance_expense_batches')).rows).toEqual([{count:2}]);
    expect((await db.query("select count(*)::int count from audit_log where action='downstream_released'")).rows).toEqual([{count:1}]);
  });
});
