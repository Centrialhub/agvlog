// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration=readFileSync(
  'supabase/migrations/20260910182855_complete_delivery_receipt_physical_return_workflow.sql','utf8',
);
const ids={
  tenant:'20000000-0000-4000-8000-000000000001',user:'10000000-0000-4000-8000-000000000001',
  receipt:'70000000-0000-4000-8000-000000000001',trip:'80000000-0000-4000-8000-000000000001',
  stop:'82000000-0000-4000-8000-000000000001',driver:'60000000-0000-4000-8000-000000000001',
  vehicle:'61000000-0000-4000-8000-000000000001',client:'30000000-0000-4000-8000-000000000001',
  load:'50000000-0000-4000-8000-000000000001',request:'40000000-0000-4000-8000-000000000001',
};
let db:PGlite;

async function command(status:'received'|'missing'|'waived',reason:string|null,requestId=ids.request){
  return (await db.query<{result:{physical_status:string;replayed:boolean;occurrence_event_id:string|null}}>(
    'select record_delivery_receipt_physical_status_v1($1,$2,$3,$4,$5,null) result',
    [ids.tenant,ids.receipt,requestId,status,reason],
  )).rows[0].result;
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.tenants(id uuid primary key);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,load_id uuid);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,client_id uuid);
    create table public.dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_stop_id uuid,load_id uuid);
    create table public.delivery_receipts(
      id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,driver_id uuid,vehicle_id uuid,
      is_active boolean,physical_status text,physical_received_at timestamptz,physical_received_by uuid,updated_at timestamptz
    );
    create table public.operational_events(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,load_id uuid,vehicle_id uuid,driver_id uuid,
      dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,severity text,description text,visible_to_client boolean,
      client_action_required boolean,public_status text,payload jsonb,idempotency_key text,created_by uuid
    );
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,
      entity_id uuid,action text,old_value jsonb,new_value jsonb,source text);
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source)
      values($1,$2,$3,$4,$5,$6,$7)$$;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select true$$;
    create function public.is_tenant_admin(uuid) returns boolean language sql stable as
      $$select current_setting('request.test.admin',true)='true'$$;
  `);
  await db.exec(migration);
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',ids.user]);
});
beforeEach(async()=>{
  await db.exec('truncate public.delivery_receipt_physical_events,public.entity_audit_log,public.operational_events,public.dispatch_stop_documents,public.delivery_receipts,public.dispatch_stops,public.dispatch_trips,public.tenants');
  await db.query('select set_config($1,$2,false)',['request.test.admin','false']);
  await db.query('insert into public.tenants values($1)',[ids.tenant]);
  await db.query('insert into public.dispatch_trips values($1,$2,$3)',[ids.trip,ids.tenant,ids.load]);
  await db.query('insert into public.dispatch_stops values($1,$2,$3)',[ids.stop,ids.tenant,ids.client]);
  await db.query('insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,load_id) values($1,$2,$3)',[ids.tenant,ids.stop,ids.load]);
  await db.query(`insert into public.delivery_receipts values($1,$2,$3,$4,$5,$6,true,'pending_return',null,null,now())`,
    [ids.receipt,ids.tenant,ids.trip,ids.stop,ids.driver,ids.vehicle]);
});
afterAll(async()=>db?.close());

describe('delivery receipt physical return workflow',()=>{
  it('marks missing paper and creates one linked operational occurrence',async()=>{
    const result=await command('missing','Canhoto físico não foi devolvido pelo motorista.');
    expect(result).toMatchObject({physical_status:'missing',replayed:false,occurrence_event_id:expect.any(String)});
    expect((await db.query('select event_type,severity,client_id,load_id from public.operational_events')).rows)
      .toEqual([{event_type:'delivery_receipt_physical_missing',severity:'medium',client_id:ids.client,load_id:ids.load}]);
    expect((await db.query('select previous_status,resulting_status,reason from public.delivery_receipt_physical_events')).rows)
      .toEqual([{previous_status:'pending_return',resulting_status:'missing',reason:'Canhoto físico não foi devolvido pelo motorista.'}]);
  });

  it('replays the same request without duplicating the occurrence',async()=>{
    await command('missing','Papel extraviado durante o retorno da viagem.');
    const replay=await command('missing','Papel extraviado durante o retorno da viagem.');
    expect(replay.replayed).toBe(true);
    expect((await db.query<{count:number}>('select count(*)::int count from public.operational_events')).rows[0].count).toBe(1);
  });

  it('requires owner/admin authority and a reason to waive the paper',async()=>{
    await expect(command('waived','Dispensa autorizada por exceção operacional.')).rejects.toMatchObject({code:'42501'});
    await db.query('select set_config($1,$2,false)',['request.test.admin','true']);
    await expect(command('waived','Dispensa autorizada por exceção operacional.')).resolves.toMatchObject({physical_status:'waived'});
    expect((await db.query<{count:number}>('select count(*)::int count from public.operational_events')).rows[0].count).toBe(0);
  });

  it('prevents invalid reasons and regression after physical receipt',async()=>{
    await expect(command('missing','x')).rejects.toMatchObject({code:'22023'});
    await command('received',null);
    await expect(command('missing','Tentativa de regredir um papel já recebido.',crypto.randomUUID())).rejects.toMatchObject({code:'23514'});
  });
});
