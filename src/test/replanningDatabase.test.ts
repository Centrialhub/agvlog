// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createReplanningDatabase,replanningIds as i,seedReplanning,twoPlannedTrips,replanningContext,replanningPayload,replan} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createReplanningDatabase();},30000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await seedReplanning(db);});
const count=async(sql:string,params:unknown[]=[])=>Number((await db.query<{n:number}>(sql,params)).rows[0].n);
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
  'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
  'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
].map(table=>`'${table}',(select jsonb_agg(to_jsonb(t) order by id) from ${table} t)`).join(',')}) state`)).rows[0]);
async function unchanged(payload:unknown,pattern:RegExp){const before=await state();await expect(replan(db,payload)).rejects.toThrow(pattern);expect(await state()).toBe(before);}

describe('explicit replanning SQL candidate',()=>{
  it('moves between different planned trips, preserves stop history and cancels only the emptied trip',async()=>{
    const trips=await twoPlannedTrips(db);const result=await replan(db,await replanningPayload(db,{mode:'existing',stop_id:trips.targetStop}));
    expect(result).toMatchObject({moved:1,source_removed:true,target_stop_id:trips.targetStop,retired_stop_ids:[trips.sourceStop],cancelled_trip_ids:[trips.sourceTrip]});
    expect((await db.query('select status,actual_start_at,actual_end_at from dispatch_trips where id=$1',[trips.sourceTrip])).rows[0])
      .toEqual({status:'cancelled',actual_start_at:null,actual_end_at:null});
    expect(await count('select count(*) n from dispatch_stop_documents where dispatch_stop_id=$1',[trips.targetStop])).toBe(2);
    expect(await count('select count(*) n from dispatch_stops')).toBe(2);
    expect(await count('select count(*) n from driver_settlements')).toBe(0);
  });
  it('retains the original occurrence, load and stop identities instead of cascading away their history',async()=>{
    const trips=await twoPlannedTrips(db);
    await db.query("insert into operational_events(tenant_id,load_id,dispatch_trip_id,dispatch_stop_id,event_type,severity,description) values($1,$2,$3,$4,'other','low','Histórico preservado')",[i.tenant,i.load,trips.sourceTrip,trips.sourceStop]);
    const before=(await db.query('select * from operational_events')).rows;
    const result=await replan(db,await replanningPayload(db,{mode:'existing',stop_id:trips.targetStop}));
    expect(result.source_removed).toBe(false);expect((await db.query('select * from operational_events')).rows).toEqual(before);
    expect(await count('select count(*) n from loads where id=$1',[i.load])).toBe(1);
  });
  it('creates an explicitly located destination and replays its original response after source deletion',async()=>{
    const trips=await twoPlannedTrips(db);const payload=await replanningPayload(db,{mode:'new',destination:'Portaria nova',latitude:-23.5,longitude:-46.6,client_id:i.client});
    const result=await replan(db,payload);expect(result.target_stop_id).not.toBe(trips.targetStop);
    const before=await state();expect(await replan(db,payload)).toEqual(result);expect(await state()).toBe(before);
    expect(await count("select count(*) n from dispatch_stops where destination='Portaria nova'")).toBe(1);
  });
  it('moves from an assigned route to an unassigned load only with an explicit unassigned target',async()=>{
    const trips=await twoPlannedTrips(db);
    await db.query('delete from dispatch_stop_documents where dispatch_stop_id=$1',[trips.targetStop]);
    await db.query("update dispatch_stops set status='cancelled' where id=$1",[trips.targetStop]);
    await db.query('delete from dispatch_trip_loads where dispatch_trip_id=$1',[trips.targetTrip]);
    await db.query("update dispatch_trips set status='cancelled' where id=$1",[trips.targetTrip]);
    const result=await replan(db,await replanningPayload(db));expect(result.target_stop_id).toBeNull();
    expect(await count('select count(*) n from dispatch_stop_documents')).toBe(0);
  });
  it('moves unassigned manual cargo and never deletes manual items left behind',async()=>{
    await db.exec('update load_items set fiscal_document_id=null');const result=await replan(db,await replanningPayload(db));
    expect(result).toMatchObject({moved:1,source_removed:false,document_ids:[]});
    expect(await count('select count(*) n from load_items where load_id=$1',[i.load])).toBe(1);
  });
  it('rejects stale graph revision before moving or creating a stop',async()=>{
    const trips=await twoPlannedTrips(db);const payload=await replanningPayload(db,{mode:'existing',stop_id:trips.targetStop});
    await db.query("update dispatch_stops set destination='Alterado por outro operador' where id=$1",[trips.targetStop]);
    await unchanged(payload,/replanning_revision_changed/);
  });
  it('rejects changed body with the same successful request key',async()=>{
    const payload=await replanningPayload(db);await replan(db,payload);await unchanged({...payload,reason:'Outro motivo'},/replanning_idempotency_mismatch/);
  });
  it('checks membership again on replay',async()=>{
    const payload=await replanningPayload(db);await replan(db,payload);
    await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await unchanged(payload,/not_authorized/);
  });
  it('rejects incomplete invoice selection',async()=>{
    await db.query('insert into load_items(id,tenant_id,load_id,fiscal_document_id,quantity) values($1,$2,$3,$4,1)',
      ['91000000-0000-4000-8000-000000000003',i.tenant,i.load,i.doc]);
    await unchanged(await replanningPayload(db),/composition_document_split_not_allowed/);
  });
  it('rejects a foreign target and prevents the context API leaking its graph',async()=>{
    const payload=await replanningPayload(db);await db.query('update loads set tenant_id=$1 where id=$2',[i.otherTenant,i.load2]);
    await expect(replanningContext(db)).rejects.toThrow(/load_ownership_mismatch/);await unchanged(payload,/load_ownership_mismatch/);
  });
  it('rejects new destination without GPS coordinates instead of guessing them',async()=>{
    await twoPlannedTrips(db);await unchanged(await replanningPayload(db,{mode:'new',destination:'Sem coordenadas'}),/coordinates_required/);
  });
  it('requires the target stop to belong to the actual destination trip',async()=>{
    const trips=await twoPlannedTrips(db);await unchanged(await replanningPayload(db,{mode:'existing',stop_id:trips.sourceStop}),/invalid_replanning_target_stop/);
  });
  it('does not move delivery evidence or issue/cancel fiscal documents',async()=>{
    const payload=await replanningPayload(db);
    await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,status,storage_path) values($1,$2,$3,'uploaded','QA-proof')",[i.tenant,i.doc,i.load]);
    await unchanged(payload,/replanning_has_delivery_evidence/);
  });
  it('requires fiscal review for an invoice already linked to an issued CT-e',async()=>{
    const payload=await replanningPayload(db);await db.query('update fiscal_documents set cte_emitted_at=now() where id=$1',[i.doc]);
    await unchanged(payload,/replanning_requires_fiscal_review/);
  });
  it('does not manufacture an actual departure when the driver already started the route',async()=>{
    const trips=await twoPlannedTrips(db);const payload=await replanningPayload(db,{mode:'existing',stop_id:trips.targetStop});
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await compositionRpc(db,'select public.driver_start_trip($1)',[trips.sourceTrip]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await unchanged(payload,/load_locked/);
  });
  it('keeps private helpers non-callable and exposes only the authorized read/write API',async()=>{
    for(const [signature,exposed] of [['_load_replanning_snapshot(uuid,uuid[])',false],['_assert_load_replanning_graph(uuid,uuid[])',false],
      ['get_load_replanning_context(uuid,uuid,uuid)',true],['replan_load_items(jsonb)',true]] as const){
      const row=(await db.query('select has_function_privilege(\'anon\',$1,\'execute\') anon,has_function_privilege(\'authenticated\',$1,\'execute\') authenticated,has_function_privilege(\'service_role\',$1,\'execute\') service',[`public.${signature}`])).rows[0];
      expect(row).toEqual({anon:false,authenticated:exposed,service:false});
    }
  });
});
