// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createPlanningDatabase,seedPlanning,dispatchPlanning,planningPayload,planningIds as i} from './helpers/planningDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createPlanningDatabase({graph:false});},30000);
beforeEach(async()=>{await seedPlanning(db);});
afterAll(async()=>{await db?.close();});

describe('captured legacy planner defect reproduction',()=>{
  it('accepts a route omitting one of the load documents',async()=>{
    const p=planningPayload();p.stops[0].fiscal_document_ids=[i.doc];await dispatchPlanning(db,p);
    expect((await db.query('select count(*)::int n from dispatch_stop_documents')).rows).toEqual([{n:1}]);
    expect((await db.query('select count(*)::int n from load_items')).rows).toEqual([{n:2}]);
  });
  it('accepts the same documents in distinct stops',async()=>{
    const p=planningPayload();p.stops.push({...p.stops[0],destination:'Duplicada'});await dispatchPlanning(db,p);
    expect((await db.query('select count(*)::int n from dispatch_stop_documents')).rows).toEqual([{n:4}]);
  });
  it('dispatches a held load',async()=>{
    await db.query('update loads set on_hold=true where id=$1',[i.load]);await dispatchPlanning(db);
    expect((await db.query('select status,on_hold from loads where id=$1',[i.load])).rows).toEqual([{status:'loading',on_hold:true}]);
  });
  it('regresses a delivered load to loading',async()=>{
    await db.query("update loads set status='delivered' where id=$1",[i.load]);await dispatchPlanning(db);
    expect((await db.query('select status from loads where id=$1',[i.load])).rows).toEqual([{status:'loading'}]);
  });
  it('accepts foreign-tenant driver, vehicle and client identifiers',async()=>{
    const p=planningPayload();p.driver_id=i.otherDriver;p.vehicle_id=i.otherVehicle;p.stops[0].client_id=i.otherClient;
    const trip=await dispatchPlanning(db,p);
    expect((await db.query('select driver_id,vehicle_id from dispatch_trips where id=$1',[trip])).rows).toEqual([{driver_id:i.otherDriver,vehicle_id:i.otherVehicle}]);
  });
  it('cannot replay a successful request even when the client supplied a stable key',async()=>{
    await dispatchPlanning(db);await expect(dispatchPlanning(db)).rejects.toThrow('já despachadas');
    expect((await db.query('select count(*)::int n from dispatch_trips')).rows).toEqual([{n:1}]);
  });
});
