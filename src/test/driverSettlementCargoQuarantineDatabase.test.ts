// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA='20000000-0000-4000-8000-000000000071';
const tenantB='20000000-0000-4000-8000-000000000072';
const actor='10000000-0000-4000-8000-000000000071';
const driver='60000000-0000-4000-8000-000000000071';
const vehicle='61000000-0000-4000-8000-000000000071';
const trip='80000000-0000-4000-8000-000000000071';
const settlement='70000000-0000-4000-8000-000000000071';
const tripPaid='80000000-0000-4000-8000-000000000073';
const settlementPaid='70000000-0000-4000-8000-000000000073';
const tripApproved='80000000-0000-4000-8000-000000000074';
const settlementApproved='70000000-0000-4000-8000-000000000074';
const request='a0000000-0000-4000-8000-000000000071';
let db:PGlite;

const migration=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
const setting=(name:string,value:string)=>db.query('select set_config($1,$2,false)',[name,value]);

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

    create table tenants(id uuid primary key);
    create table drivers(id uuid primary key,tenant_id uuid,name text,user_id uuid);
    create table vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,status text,
      actual_end_at timestamptz,planned_start_at timestamptz);
    create table trip_cargo_controls(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,driver_id uuid,vehicle_id uuid,status text,seal_not_applicable_reason text,
      closed_at timestamptz,closed_by uuid,close_override_reason text,unique(tenant_id,dispatch_trip_id));
    create table driver_settlements(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,driver_id uuid,vehicle_id uuid,status text default 'pending_review',
      loads_count integer default 1,documents_count integer default 1,estimated_km numeric default 1,
      total_invoice_value numeric default 1,total_freight_value numeric default 1,
      needs_recalculation boolean default false,last_recalculated_at timestamptz default now(),
      driver_payable_amount numeric default 100,total_paid_amount numeric default 0,payment_balance numeric default 100,
      unique(tenant_id,dispatch_trip_id));
    alter table driver_settlements enable row level security;
    grant select,update on driver_settlements to authenticated;
    create policy settlements_select on driver_settlements for select to authenticated using(tenant_id=private.request_tenant_id());
    create table driver_settlement_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      settlement_id uuid,receipt_url text);
    create table finance_expense_batches(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      context text,trip_id uuid);
    create table driver_expenses(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,description text);
    create table finance_movements(id uuid primary key,tenant_id uuid,beneficiary_name text,occurred_on date,
      bank_reference text,description text,amount_cents bigint,driver_id uuid,direction text,nature text);
    create table finance_expense_allocations(tenant_id uuid,movement_id uuid,amount_cents bigint);
    create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
    create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,destination text);
    create table physical_journeys(id uuid primary key,status text,actual_end_at timestamptz,updated_at timestamptz);
    create table physical_journey_trips(physical_journey_id uuid,dispatch_trip_id uuid);
    create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,new_data jsonb);

    create function public.is_tenant_operator_or_admin(_tenant uuid) returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.operator',true),''),'true')::boolean
        and private.request_tenant_id()=_tenant$$;
    create function public.is_tenant_admin(_tenant uuid) returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.admin',true),''),'false')::boolean
        and private.request_tenant_id()=_tenant$$;
    create function finance_private.can_access(_tenant uuid) returns boolean language sql stable as $$
      select private.request_tenant_id()=_tenant
        and coalesce(nullif(current_setting('test.finance_access',true),''),'true')::boolean
        and not coalesce(nullif(current_setting('test.driver_identity',true),''),'false')::boolean$$;
    create function finance_private.require_access(uuid) returns void language plpgsql stable as $$begin
      if not finance_private.can_access($1) then raise exception 'finance_access_denied' using errcode='42501';end if;end$$;
    create function finance_private.delivery_context(uuid,uuid) returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.audit_log(tenant_id,entity_type,entity_id,action,new_data) values($1,$2,$3,$4,$6)$$;
    create function public._build_driver_settlement(uuid,uuid) returns uuid language plpgsql as $$
      declare result uuid;begin
        insert into public.driver_settlements(tenant_id,dispatch_trip_id,driver_id,vehicle_id)
          select $1,trip.id,trip.driver_id,trip.vehicle_id from public.dispatch_trips trip where trip.id=$2
        on conflict(tenant_id,dispatch_trip_id) do update set last_recalculated_at=clock_timestamp()
        returning id into result;return result;
      end$$;
    create function finance_private.record_settlement_payment(_payload jsonb) returns jsonb
    language plpgsql security definer set search_path='' as $$begin
      perform finance_private.require_access((_payload->>'tenant_id')::uuid);
      insert into public.driver_settlement_payments(tenant_id,settlement_id)
        values((_payload->>'tenant_id')::uuid,(_payload->>'settlement_id')::uuid);
      return jsonb_build_object('confirmed',true);
    end$$;
    revoke all on function finance_private.record_settlement_payment(jsonb) from public,anon,authenticated,service_role;
    grant execute on function finance_private.record_settlement_payment(jsonb) to authenticated;
    grant usage on schema private,finance_private to authenticated;
    grant execute on function private.request_tenant_id(),finance_private.can_access(uuid) to authenticated;
    create function public.list_driver_settlements(_tenant_id uuid,_status text,_driver_id uuid,_vehicle_id uuid,
      _search text,_date_from date,_date_to date,_needs_review boolean,_has_divergence boolean,_has_pending_expenses boolean,
      _has_open_balance boolean,_page integer,_page_size integer) returns jsonb language plpgsql security definer
      set search_path='' as $$declare items jsonb;begin
        perform finance_private.require_access(_tenant_id);
        if private.request_tenant_id() is distinct from _tenant_id then raise exception 'active_tenant_required';end if;
        select coalesce(jsonb_agg(to_jsonb(s)),'[]') into items FROM public.driver_settlements s
        WHERE s.tenant_id = _tenant_id;
        return jsonb_build_object('items',items);
      end$$;

    insert into auth.users values('${actor}');
    insert into tenants values('${tenantA}'),('${tenantB}');
    insert into drivers values('${driver}','${tenantA}','Motorista','${actor}');
    insert into vehicles values('${vehicle}','${tenantA}','LEG0ACY');
    insert into dispatch_trips values('${trip}','${tenantA}','${driver}','${vehicle}','completed',clock_timestamp(),clock_timestamp());
    insert into dispatch_trips values
      ('${tripPaid}','${tenantA}','${driver}','${vehicle}','completed',clock_timestamp(),clock_timestamp()),
      ('${tripApproved}','${tenantA}','${driver}','${vehicle}','completed',clock_timestamp(),clock_timestamp());
    insert into driver_settlements(id,tenant_id,dispatch_trip_id,driver_id,vehicle_id,status)
      values('${settlement}','${tenantA}','${trip}','${driver}','${vehicle}','in_review');
    insert into driver_settlements(id,tenant_id,dispatch_trip_id,driver_id,vehicle_id,status,
      driver_payable_amount,total_paid_amount,payment_balance) values
      ('${settlementPaid}','${tenantA}','${tripPaid}','${driver}','${vehicle}','paid',250,250,0),
      ('${settlementApproved}','${tenantA}','${tripApproved}','${driver}','${vehicle}','approved',175,0,175);
    insert into driver_settlement_payments(tenant_id,settlement_id,receipt_url)
      values('${tenantA}','${settlementPaid}','legacy-paid-receipt.pdf');
    select set_config('request.jwt.claim.sub','${actor}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    select set_config('test.active_tenant','${tenantA}',false);
    select set_config('test.operator','true',false);
    select set_config('test.admin','false',false);
    select set_config('test.finance_access','true',false);
    select set_config('test.driver_identity','false',false);
  `);
  await db.exec(migration('20260910211800_canonical_trip_cargo_close_gate'));
  await db.exec(migration('20260910213156_quarantine_legacy_settlements_until_cargo_close'));
},30_000);

afterAll(async()=>db?.close());

describe('legacy settlement cargo quarantine and historical reconciliation',()=>{
  it('keeps history but blocks approval, payment, list consumers and finance batches while operational expense capture remains open',async()=>{
    expect((await db.query('select status from driver_settlement_cargo_quarantines where settlement_id=$1',[settlement])).rows)
      .toEqual([{status:'pending'}]);
    expect((await db.query('select count(*)::int count from driver_settlements where id=$1',[settlement])).rows)
      .toEqual([{count:1}]);
    const listed=(await db.query<{result:{items:unknown[]}}>(
      'select list_driver_settlements($1,null,null,null,null,null,null,null,null,null,null,1,30) result',[tenantA])).rows[0].result;
    expect(listed.items).toEqual([]);
    await expect(db.query("update driver_settlements set status='approved' where id=$1",[settlement]))
      .rejects.toThrow('driver_settlement_cargo_quarantined');
    await expect(db.query('select finance_private.record_settlement_payment($1::jsonb)',
      [JSON.stringify({tenant_id:tenantA,settlement_id:settlement})])).rejects.toThrow('driver_settlement_cargo_quarantined');
    await expect(db.query('insert into driver_settlement_payments(tenant_id,settlement_id) values($1,$2)',[tenantA,settlement]))
      .rejects.toThrow('driver_settlement_cargo_quarantined');
    await expect(db.query("insert into finance_expense_batches(tenant_id,context,trip_id) values($1,'trip',$2)",[tenantA,trip]))
      .rejects.toThrow('trip_cargo_not_closed');
    await db.query("insert into driver_expenses(tenant_id,dispatch_trip_id,description) values($1,$2,'Pedágio durante viagem')",[tenantA,trip]);
    expect((await db.query('select count(*)::int count from driver_expenses where dispatch_trip_id=$1',[trip])).rows)
      .toEqual([{count:1}]);
  });

  it('enforces finance, hybrid-identity, active-tenant and admin boundaries',async()=>{
    const args=[tenantA,trip,request,'Reconciliação histórica aprovada após conferência documental completa.',
      JSON.stringify({basis:'Manifesto físico, canhoto e inventário conferidos pelo administrador.'})];
    await setting('test.driver_identity','true');
    await expect(db.query('select reconcile_historical_trip_cargo_v1($1,$2,$3,$4,$5::jsonb)',args))
      .rejects.toThrow('finance_access_denied');
    await setting('test.driver_identity','false');await setting('test.finance_access','false');
    await expect(db.query('select reconcile_driver_settlement_cargo_quarantine_v1($1,$2,$3)',
      [tenantA,settlement,'Tentativa híbrida deve ser recusada.'])).rejects.toThrow('finance_access_denied');
    await setting('test.finance_access','true');await setting('test.active_tenant',tenantB);
    await expect(db.query('select reconcile_historical_trip_cargo_v1($1,$2,$3,$4,$5::jsonb)',args))
      .rejects.toThrow('finance_access_denied');
    await setting('test.active_tenant',tenantA);
    await expect(db.query('select reconcile_historical_trip_cargo_v1($1,$2,$3,$4,$5::jsonb)',args))
      .rejects.toThrow('historical_cargo_reconciliation_not_authorized');
  });

  it('materializes one canonical closed control, resolves quarantine idempotently and releases downstream consumers',async()=>{
    await setting('test.admin','true');
    const reason='Reconciliação histórica aprovada após conferência documental completa.';
    const evidence={basis:'Manifesto físico, canhoto e inventário conferidos pelo administrador.'};
    const call=()=>db.query<{result:Record<string,unknown>}>(
      'select reconcile_historical_trip_cargo_v1($1,$2,$3,$4,$5::jsonb) result',
      [tenantA,trip,request,reason,JSON.stringify(evidence)]);
    expect((await call()).rows[0].result).toMatchObject({confirmed:true,status:'closed',replayed:false,quarantines_pending:0});
    expect((await call()).rows[0].result).toMatchObject({confirmed:true,status:'closed',replayed:true});
    expect((await db.query('select count(*)::int count from trip_cargo_controls where dispatch_trip_id=$1 and status=$2',[trip,'closed'])).rows)
      .toEqual([{count:1}]);
    expect((await db.query('select status from driver_settlement_cargo_quarantines where settlement_id=$1',[settlement])).rows)
      .toEqual([{status:'resolved'}]);
    expect((await db.query("select count(*)::int count from audit_log where action in('cargo_close_quarantine_resolved','historical_cargo_reconciled')")).rows)
      .toEqual([{count:2}]);
    const listed=(await db.query<{result:{items:Array<{id:string}>}}>(
      'select list_driver_settlements($1,null,null,null,null,null,null,null,null,null,null,1,30) result',[tenantA])).rows[0].result;
    expect(listed.items.map(item=>item.id)).toEqual([settlement]);
    await db.query("update driver_settlements set status='approved' where id=$1",[settlement]);
    expect((await db.query<{result:Record<string,unknown>}>(
      'select finance_private.record_settlement_payment($1::jsonb) result',
      [JSON.stringify({tenant_id:tenantA,settlement_id:settlement})])).rows[0].result).toMatchObject({confirmed:true});
  });

  it('reconciles approved and paid history without rebuilding or altering amounts, status or payments',async()=>{
    for(const [historicalTrip,historicalSettlement,historicalRequest] of [
      [tripPaid,settlementPaid,'a0000000-0000-4000-8000-000000000073'],
      [tripApproved,settlementApproved,'a0000000-0000-4000-8000-000000000074'],
    ]){
      const before=(await db.query('select status,driver_payable_amount,total_paid_amount,payment_balance '+
        'from driver_settlements where id=$1',[historicalSettlement])).rows[0];
      const paymentsBefore=(await db.query<{count:number}>('select count(*)::int count from driver_settlement_payments '+
        'where settlement_id=$1',[historicalSettlement])).rows[0].count;
      await db.query('select reconcile_historical_trip_cargo_v1($1,$2,$3,$4,$5::jsonb)',[
        tenantA,historicalTrip,historicalRequest,
        'Reconciliação histórica de liquidação já consolidada e conferida.',
        JSON.stringify({basis:'Arquivo físico e razão financeiro histórico conferidos integralmente.'}),
      ]);
      expect((await db.query('select status,driver_payable_amount,total_paid_amount,payment_balance '+
        'from driver_settlements where id=$1',[historicalSettlement])).rows[0]).toEqual(before);
      expect((await db.query<{count:number}>('select count(*)::int count from driver_settlement_payments '+
        'where settlement_id=$1',[historicalSettlement])).rows[0].count).toBe(paymentsBefore);
      expect((await db.query('select status from driver_settlement_cargo_quarantines where settlement_id=$1',
        [historicalSettlement])).rows).toEqual([{status:'resolved'}]);
      expect((await db.query('select status from trip_cargo_controls where dispatch_trip_id=$1',[historicalTrip])).rows)
        .toEqual([{status:'closed'}]);
    }
  });

  it('keeps direct reads bound to the active tenant and finance access',async()=>{
    await setting('test.active_tenant',tenantB);
    await db.exec('set role authenticated');
    try{
      expect((await db.query('select count(*)::int count from driver_settlements')).rows).toEqual([{count:0}]);
      expect((await db.query('select count(*)::int count from driver_settlement_cargo_quarantines')).rows).toEqual([{count:0}]);
    }finally{await db.exec('reset role');}
    await setting('test.active_tenant',tenantA);await setting('test.finance_access','false');
    await db.exec('set role authenticated');
    try{
      expect((await db.query('select count(*)::int count from driver_settlements')).rows).toEqual([{count:0}]);
      expect((await db.query('select count(*)::int count from driver_settlement_cargo_quarantines')).rows).toEqual([{count:0}]);
    }finally{await db.exec('reset role');}
    await setting('test.finance_access','true');
  });
});
