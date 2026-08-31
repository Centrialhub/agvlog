// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createPlanningDatabase,seedPlanning,dispatchPlanning,planningPayload,planningCandidateSql,planningIds as i} from './helpers/planningDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createPlanningDatabase({candidate:true});},30000);
beforeEach(async()=>{await seedPlanning(db);});
afterAll(async()=>{await db?.close();});
async function state(){return (await db.query(`select jsonb_build_object(
  'loads',(select jsonb_agg(to_jsonb(t) order by id) from loads t),
  'trips',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trips t),
  'stops',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_stops t),
  'links',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trip_loads t),
  'documents',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_stop_documents t),
  'fiscal',(select jsonb_agg(to_jsonb(t) order by id) from fiscal_documents t),
  'keys',(select jsonb_agg(to_jsonb(t) order by id) from idempotency_keys t),
  'draft',(select jsonb_agg(to_jsonb(t) order by id) from route_planning_drafts t),
  'history',(select jsonb_agg(to_jsonb(t)) from load_status_history t),
  'audit',(select jsonb_agg(to_jsonb(t)) from entity_audit_log t),
  'settlements',(select jsonb_agg(to_jsonb(t)) from driver_settlements t)) state`)).rows;}
async function rejected(payload:unknown,message:string){const before=await state();
  await expect(dispatchPlanning(db,payload)).rejects.toThrow(message);expect(await state()).toEqual(before);}

describe('hardened operational planner feeding the driver graph',()=>{
  it('creates one planned trip with canonical mirrors, complete stop documents and audited loading',async()=>{
    const trip=await dispatchPlanning(db);
    expect((await db.query('select status,actual_start_at,driver_id,vehicle_id,load_id from dispatch_trips where id=$1',[trip])).rows)
      .toEqual([{status:'planned',actual_start_at:null,driver_id:i.driver,vehicle_id:i.vehicle,load_id:i.load}]);
    expect((await db.query('select status,trip_id,driver_id,vehicle_id from loads where id=$1',[i.load])).rows)
      .toEqual([{status:'loading',trip_id:trip,driver_id:i.driver,vehicle_id:i.vehicle}]);
    expect((await db.query('select fiscal_document_id,load_id from dispatch_stop_documents order by fiscal_document_id')).rows)
      .toEqual([{fiscal_document_id:i.doc,load_id:i.load},{fiscal_document_id:i.doc2,load_id:i.load}]);
    expect((await db.query('select old_value,new_value,created_by from load_status_history')).rows)
      .toEqual([{old_value:'planned',new_value:'loading',created_by:i.operator}]);
  });
  it('replays without another trip, history entry, draft update or timestamp change',async()=>{
    const p={...planningPayload(),planning_draft_id:i.draft};const first=await dispatchPlanning(db,p);const before=await state();
    expect(await dispatchPlanning(db,p)).toBe(first);expect(await state()).toEqual(before);
  });
  it('supports identical legacy requests without an explicit request key',async()=>{
    const {idempotency_key:_,...p}=planningPayload();const first=await dispatchPlanning(db,p);const before=await state();
    expect(await dispatchPlanning(db,p)).toBe(first);expect(await state()).toEqual(before);
  });
  it('rejects payload changes under the same key instead of dispatching a different route',async()=>{
    const p=planningPayload();await dispatchPlanning(db,p);await rejected({...p,route_name:'Changed'},'dispatch_idempotency_mismatch');
  });
  it('does not reuse another operator\'s request or allow a new key to duplicate assigned loads',async()=>{
    await dispatchPlanning(db);await rejected({...planningPayload(),idempotency_key:'another'},'load_not_eligible');
    const another='10000000-0000-4000-8000-000000000012';
    await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[another,i.tenant]);
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',another]);
    await rejected(planningPayload(),'load_not_eligible');
  });
  it('checks operator membership again even for a previously successful key',async()=>{
    await dispatchPlanning(db);await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
    await rejected(planningPayload(),'not_authorized');
  });
  it.each(['',i.user])('denies non-operator subject %s before graph writes',async subject=>{
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',subject]);
    await rejected(planningPayload(),'not_authorized');
  });
  it('rejects a foreign tenant supplied in the payload',async()=>{
    await rejected({...planningPayload(),tenant_id:i.otherTenant},'not_authorized');
  });
  it.each([
    ['driver_id',i.otherDriver,'invalid_driver_for_tenant'],['vehicle_id',i.otherVehicle,'invalid_vehicle_for_tenant'],
    ['driver_id',null,'invalid_driver_for_tenant'],['vehicle_id',null,'invalid_vehicle_for_tenant'],
  ])('rejects %s=%s without partial work',async(key,value,error)=>{
    await rejected({...planningPayload(),[key as string]:value},error as string);
  });
  it.each(['drivers','vehicles'])('rejects inactive assignment in %s',async table=>{
    await db.exec(`update ${table} set active=false`);await rejected(planningPayload(),table==='drivers'?'invalid_driver':'invalid_vehicle');
  });
  it('rejects a held load',async()=>{
    await db.query('update loads set on_hold=true where id=$1',[i.load]);await rejected(planningPayload(),'load_not_eligible');
  });
  it.each(['delivered','cancelled','partial_delivery','returned','refused','failed',null])('never regresses a %s load',async status=>{
    await db.query('update loads set status=$1 where id=$2',[status,i.load]);await rejected(planningPayload(),'load_not_eligible');
  });
  it('preserves the loaded state when planning an already-loaded but unassigned load',async()=>{
    await db.query("update loads set status='loaded' where id=$1",[i.load]);await dispatchPlanning(db);
    expect((await db.query('select status from loads where id=$1',[i.load])).rows).toEqual([{status:'loaded'}]);
    expect((await db.query('select count(*)::int n from load_status_history')).rows).toEqual([{n:0}]);
  });
  it('rejects incomplete document coverage',async()=>{
    const p=planningPayload();p.stops[0].fiscal_document_ids=[i.doc];await rejected(p,'dispatch_document_coverage_mismatch');
  });
  it('rejects documents repeated across stops',async()=>{
    const p=planningPayload();p.stops.push({...p.stops[0],destination:'Second'});await rejected(p,'duplicate_dispatch_documents');
  });
  it('rejects a duplicate document inside one stop',async()=>{
    const p=planningPayload();p.stops[0].fiscal_document_ids.push(i.doc);await rejected(p,'duplicate_dispatch_documents');
  });
  it('rejects a foreign client even with valid load documents',async()=>{
    const p=planningPayload();p.stops[0].client_id=i.otherClient;await rejected(p,'invalid_client_for_tenant');
  });
  it('rejects a stop client inconsistent with its documents',async()=>{
    await db.query('update clients set tenant_id=$1 where id=$2',[i.tenant,i.otherClient]);
    const p=planningPayload();p.stops[0].client_id=i.otherClient;await rejected(p,'dispatch_stop_client_mismatch');
  });
  it('rejects stop load IDs that disagree with document ownership',async()=>{
    const p=planningPayload();p.stops[0].load_ids=[i.load2];await rejected(p,'dispatch_stop_load_mismatch');
  });
  it('infers stop loads for the compatible LoadDetail payload without explicit stop load_ids',async()=>{
    const p=planningPayload();const {load_ids:_,...stop}=p.stops[0];
    await dispatchPlanning(db,{...p,stops:[stop]});
    expect((await db.query('select distinct load_id from dispatch_stop_documents')).rows).toEqual([{load_id:i.load}]);
  });
  it('rejects outbound documents before operational state changes',async()=>{
    await db.query("update fiscal_documents set document_type='outbound' where id=$1",[i.doc]);
    await rejected(planningPayload(),'invalid_dispatch_document');
  });
  it('rejects a document mirror conflicting with canonical load_items',async()=>{
    await db.query('update fiscal_documents set load_id=$1 where id=$2',[i.load2,i.doc]);
    await rejected(planningPayload(),'dispatch_document_load_mismatch');
  });
  it('does not silently ignore manual items unsupported by the current delivery API',async()=>{
    await db.query('update load_items set fiscal_document_id=null where id=$1',[i.item]);
    await rejected(planningPayload(),'dispatch_requires_documented_items');
  });
  it.each([
    {latitude:91},{longitude:-181},{latitude:null},{latitude:'NaN'},{service_time_minutes:-1},
    {planned_arrival_at:'2030-01-02',estimated_departure_at:'2030-01-01'},
  ])('rejects invalid stop schedule/location %j',async change=>{
    const p=planningPayload();await rejected({...p,stops:[{...p.stops[0],...change}]},'invalid_dispatch_stop_schedule_or_location');
  });
  it('rolls back the whole graph even for a late invalid delivery-window cast',async()=>{
    const p=planningPayload();await rejected({...p,stops:[{...p.stops[0],delivery_window_start:'invalid'}]},'invalid input syntax');
  });
  it('rejects a foreign or already dispatched planning draft',async()=>{
    await db.query("update route_planning_drafts set status='dispatched' where id=$1",[i.draft]);
    await rejected({...planningPayload(),planning_draft_id:i.draft},'invalid_planning_draft');
  });
  it('feeds real driver start/delivery SQL and preserves financial review without payments',async()=>{
    const trip=await dispatchPlanning(db);await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',i.user]);
    await db.exec('set role authenticated');await db.query('select public.driver_start_trip($1)',[trip]);await db.exec('reset role');
    const stop=(await db.query<{id:string}>('select id from dispatch_stops where dispatch_trip_id=$1',[trip])).rows[0].id;
    // Arrival is fixture preparation: GPS/PostGIS is not covered by this test.
    await db.query("update dispatch_stops set status='arrived',actual_arrival_at=now() where id=$1",[stop]);
    await db.exec('set role authenticated');
    await db.query(`select public.driver_record_delivery_outcome($1,'failed','{"notes":"Cliente ausente"}',$2,'arrived')`,[stop,i.request]);
    await db.exec('reset role');
    expect((await db.query('select status from loads where id=$1',[i.load])).rows).toEqual([{status:'failed'}]);
    expect((await db.query('select status from dispatch_trips where id=$1',[trip])).rows).toEqual([{status:'completed'}]);
    expect((await db.query('select status from driver_settlements')).rows).toEqual([{status:'pending_review'}]);
    expect((await db.query('select count(*)::int n from driver_settlement_payments')).rows).toEqual([{n:0}]);
  });
  it('refuses rollout without the trip/load graph guards instead of weakening its preflight',async()=>{
    const probe=await createPlanningDatabase({graph:false});
    try{await expect(probe.exec(planningCandidateSql)).rejects.toThrow('requires trip/load graph hardening');}
    finally{await probe.close();}
  });
});
