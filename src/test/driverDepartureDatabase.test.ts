// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDeliveryDatabase, deliveryIds as i, recordDelivery, seedDelivery } from './helpers/deliveryDatabase';

const migration=readFileSync('supabase/migrations/20260830042313_harden_driver_stop_departure.sql','utf8');
const contract=JSON.parse(readFileSync('docs/qa/STOP-WRITERS-PREDEPLOYMENT-2026-08-30.json','utf8')) as {
  functions:{signature:string;definition:string;definition_hash:string}[];
};
const original=contract.functions.find(f=>f.signature==='driver_register_departure(uuid,text)')!;
let db:PGlite;
const depart=(notes:string|null=null)=>db.query<{id:string}>('select public.driver_register_departure($1,$2) id',[i.stop,notes]);
const state=async()=> (await db.query<{departure:string|null;events:number;audits:number;stop:string|null;trip:string|null;load:string}>(`select
  (select actual_departure_at from public.dispatch_stops where id='${i.stop}') departure,
  (select count(*)::int from public.dispatch_events where event_type='departure') events,
  (select count(*)::int from public.entity_audit_log) audits,
  (select status from public.dispatch_stops where id='${i.stop}') stop,
  (select status from public.dispatch_trips where id='${i.trip}') trip,
  (select status from public.loads where id='${i.load}') load`)).rows[0];
beforeAll(async()=>{db=await createDeliveryDatabase();await db.exec(original.definition);await db.exec(migration);},30000);
beforeEach(async()=>{await seedDelivery(db);});
afterAll(async()=>{await db?.close();});

describe('physical departure executed in PostgreSQL',()=>{
  it('records one audited physical departure without marking anything delivered',async()=>{
    await db.exec('set role authenticated');await depart('  Conferência finalizada  ');await db.exec('reset role');
    expect(await state()).toMatchObject({events:1,audits:1,stop:'arrived',trip:'in_transit',load:'in_transit'});
    expect((await state()).departure).not.toBeNull();
    expect((await db.query('select notes,created_by from public.dispatch_events')).rows[0]).toEqual({notes:'Conferência finalizada',created_by:i.user});
    expect((await db.query<{n:number}>('select count(*)::int n from public.proof_of_delivery')).rows[0].n).toBe(0);
  });
  it('replays the same event and timestamp without an extra audit',async()=>{
    const first=await depart();const before=await state();
    expect((await depart('  ')).rows).toEqual(first.rows);expect(await state()).toEqual(before);
  });
  it('replays after delivery closes the trip without creating a new departure',async()=>{
    const first=await depart();await recordDelivery(db);
    expect((await depart()).rows).toEqual(first.rows);
    expect(await state()).toMatchObject({events:1,stop:'delivered',trip:'completed',load:'delivered'});
  });
  it('does not silently replace the observation of an already recorded departure',async()=>{
    await depart('Primeira observação');const before=await state();
    await expect(depart('Outra observação')).rejects.toMatchObject({code:'23505'});
    expect(await state()).toEqual(before);
  });
  it.each(['pending','planned','arriving','delivered','returned','cancelled',null])('rejects a new departure for stop status %s',async status=>{
    await db.query('update public.dispatch_stops set status=$1',[status]);
    await expect(depart()).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({departure:null,events:0,audits:0});
  });
  it.each(['planned','completed',null])('rejects a new departure for trip status %s',async status=>{
    await db.query('update public.dispatch_trips set status=$1',[status]);
    await expect(depart()).rejects.toMatchObject({code:status===null?'22023':'23514'});
    expect(await state()).toMatchObject({departure:null,events:0});
  });
  it.each(['arrival','start','future_arrival','start_after_arrival'])('rejects missing/inconsistent %s time',async variant=>{
    if(variant==='arrival')await db.exec('update public.dispatch_stops set actual_arrival_at=null');
    if(variant==='start')await db.exec('update public.dispatch_trips set actual_start_at=null');
    if(variant==='future_arrival')await db.exec("update public.dispatch_stops set actual_arrival_at=now()+interval '1 hour'");
    if(variant==='start_after_arrival')await db.exec("update public.dispatch_trips set actual_start_at=now()+interval '1 hour'");
    await expect(depart()).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({departure:null,events:0});
  });
  it.each(['','10000000-0000-4000-8000-000000000099'])('rejects a missing/foreign identity %s',async subject=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[subject]);
    await expect(depart()).rejects.toMatchObject({code:'42501'});
    expect(await state()).toMatchObject({departure:null,events:0});
  });
  it('rejects inactive driver and a cross-tenant stop',async()=>{
    await db.exec('update public.drivers set active=false');await expect(depart()).rejects.toMatchObject({code:'42501'});
    await db.exec("update public.drivers set active=true;update public.dispatch_stops set tenant_id='20000000-0000-4000-8000-000000000099'");
    await expect(depart()).rejects.toMatchObject({code:'42501'});
    expect(await state()).toMatchObject({departure:null,events:0});
  });
  it('denies anonymous execution even if a subject setting is present',async()=>{
    await db.exec('set role anon');await expect(depart()).rejects.toMatchObject({code:'42501'});
  });
  it('rejects long notes and a missing stop without writing',async()=>{
    await expect(depart('x'.repeat(2001))).rejects.toMatchObject({code:'22023'});
    await expect(db.query('select public.driver_register_departure($1)',[i.stop2])).rejects.toMatchObject({code:'P0002'});
    expect(await state()).toMatchObject({events:0,audits:0});
  });
  it('does not fabricate a departure event for a timestamp from another flow',async()=>{
    await db.exec('update public.dispatch_stops set actual_departure_at=now()');
    await expect(depart()).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({events:0,audits:0});
  });
  it('does not repair an orphaned historical departure by inventing a timestamp',async()=>{
    await db.query(`insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type)
      values($1,$2,$3,'departure')`,[i.tenant,i.trip,i.stop]);
    await expect(depart()).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({departure:null,events:1,audits:0});
  });
  it('rolls back timestamp/event if audit writing fails',async()=>{
    const audit=(await db.query<{definition:string}>("select pg_get_functiondef('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)'::regprocedure) definition")).rows[0].definition;
    try{
      await db.exec(`create or replace function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void
        language plpgsql as $$begin raise exception 'forced audit failure';end;$$;`);
      await expect(depart()).rejects.toThrow('forced audit failure');
      expect(await state()).toMatchObject({departure:null,events:0,audits:0});
    }finally{await db.exec(audit);}
  });
  it('restores the captured body and ACL without deleting recorded departures',async()=>{
    await depart();
    await db.exec(readFileSync('docs/qa/DEPARTURE-RECOVERY-2026-08-30.sql','utf8'));
    expect((await db.query<{hash:string}>("select md5(replace(pg_get_functiondef('public.driver_register_departure(uuid,text)'::regprocedure),chr(13),'')) hash")).rows[0].hash).toBe(original.definition_hash);
    const grants=(await db.query(`select has_function_privilege('anon','public.driver_register_departure(uuid,text)','execute') anon,
      has_function_privilege('authenticated','public.driver_register_departure(uuid,text)','execute') authenticated,
      has_function_privilege('service_role','public.driver_register_departure(uuid,text)','execute') service`)).rows[0];
    expect(grants).toEqual({anon:false,authenticated:true,service:true});expect((await state()).events).toBe(1);
    await db.exec(migration);
  });
});
