// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createCompositionDatabase,compositionContracts,compositionIds as i,compositionRpc,seedComposition} from './helpers/compositionDatabase';
import {dispatchPlanning,planningPayload} from './helpers/planningDatabase';

let db:PGlite;
beforeAll(async()=>{db=await createCompositionDatabase({candidate:true});},30000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await seedComposition(db);});
const move=(ids=[i.item],source=i.load,target=i.load2)=>compositionRpc(db,
  'select public.move_load_items_between_loads($1,$2,$3,$4) result',[i.tenant,source,target,ids]);
const snapshot=async()=>JSON.stringify((await db.query(`select jsonb_build_object(
  'loads',(select jsonb_agg(to_jsonb(t) order by id) from loads t),'items',(select jsonb_agg(to_jsonb(t) order by id) from load_items t),
  'docs',(select jsonb_agg(to_jsonb(t) order by id) from fiscal_documents t),'trips',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trips t),
  'links',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trip_loads t),'stops',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_stops t),
  'stopdocs',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_stop_documents t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from entity_audit_log t),
  'settlement',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlements t),'payments',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlement_payments t)) state`)).rows[0]);
async function unchanged(action:()=>Promise<unknown>,pattern:RegExp){
  const before=await snapshot();await expect(action()).rejects.toThrow(pattern);expect(await snapshot()).toBe(before);
}
const number=async(sql:string,params:unknown[]=[])=>Number((await db.query<{value:string|number}>(sql,params)).rows[0].value);
async function sharedTrip(){
  await move([i.item2]);const payload=planningPayload();payload.load_ids=[i.load,i.load2];payload.stops[0].load_ids=[i.load,i.load2];
  return dispatchPlanning(db,payload);
}

describe('composition integrity candidate',()=>{
  it('moves the entire selection and recalculates both source and target totals',async()=>{
    const result=await move();expect(result.rows[0]).toMatchObject({result:{moved:1,source_load_id:i.load,target_load_id:i.load2,source_removed:false,document_ids:[i.doc]}});
    expect(await number('select total_weight_kg value from loads where id=$1',[i.load])).toBe(20);
    expect(await number('select total_weight_kg value from loads where id=$1',[i.load2])).toBe(10);
    expect(await number('select total_pallet_count value from loads where id=$1',[i.load])).toBe(1);
    expect(await number('select total_volume_m3 value from loads where id=$1',[i.load2])).toBe(1);
    expect(await number("select count(*) value from entity_audit_log where action in('move_items_out','move_items_in')")).toBe(2);
  });
  it('rejects tenant-B target before changing any tenant-A item or document',async()=>{
    await db.query('update loads set tenant_id=$1 where id=$2',[i.otherTenant,i.load2]);
    await unchanged(()=>move(),/load_ownership_mismatch/);
  });
  it('rejects foreign source',async()=>{
    await unchanged(()=>move([i.item],i.otherTenant),/load_ownership_mismatch/);
  });
  it.each([[],[i.item,i.item],[null],[i.item,null]].map(ids=>[ids]))('rejects empty, duplicate or null IDs: %j',async ids=>{
    await unchanged(()=>compositionRpc(db,'select public.move_load_items_between_loads($1,$2,$3,$4)',[i.tenant,i.load,i.load2,ids]),/invalid_composition_request/);
  });
  it('rejects stale selections atomically instead of returning partial success',async()=>{
    await unchanged(()=>move([i.item,'91000000-0000-4000-8000-000000000099']),/composition_items_changed/);
  });
  it('rejects same source/target',async()=>{await unchanged(()=>move([i.item],i.load,i.load),/invalid_composition_request/);});
  it.each([i.user,'10000000-0000-4000-8000-000000000099',''])('rejects non-operator identity %s',async actor=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await unchanged(()=>move(),/not_authorized/);
  });
  it('rejects revoked membership',async()=>{
    await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await unchanged(()=>move(),/not_authorized/);
  });
  it('does not delete remaining manual cargo when the last invoice is moved',async()=>{
    await db.query('update load_items set fiscal_document_id=null where id=$1',[i.item2]);await move();
    expect(await number('select count(*) value from loads where id=$1',[i.load])).toBe(1);
    expect(await number('select count(*) value from load_items where id=$1',[i.item2])).toBe(1);
    expect(await number('select total_weight_kg value from loads where id=$1',[i.load])).toBe(20);
  });
  it('moves manual items without deleting other manual items',async()=>{
    await db.exec('update load_items set fiscal_document_id=null');const result=await move();
    expect(result.rows[0]).toMatchObject({result:{moved:1,document_ids:[],source_removed:false}});
    expect(await number('select count(*) value from load_items where load_id=$1',[i.load])).toBe(1);
  });
  it('does not delete a nonempty load just because documents were marked deleted',async()=>{
    await db.exec("update fiscal_documents set status='deleted'");await db.query('select public.delete_load_if_empty($1)',[i.load]);
    expect(await number('select count(*) value from loads where id=$1',[i.load])).toBe(1);
    expect(await number('select count(*) value from load_items where load_id=$1',[i.load])).toBe(2);
  });
  it('reports actual source cleanup after moving all unplanned items',async()=>{
    const result=await move([i.item,i.item2]);expect(result.rows[0]).toMatchObject({result:{moved:2,source_removed:true}});
    expect(await number('select count(*) value from loads where id=$1',[i.load])).toBe(0);
    expect(await number('select total_weight_kg value from loads where id=$1',[i.load2])).toBe(30);
  });
  it('requires explicit replanning when moving a planned item outside its trip',async()=>{
    await dispatchPlanning(db);await unchanged(()=>move(),/composition_requires_replanning/);
  });
  it('moves within the same unstarted trip, preserves stop destination and removes an empty canonical load',async()=>{
    const trip=await sharedTrip();const before=(await db.query('select id,destination,client_id from dispatch_stops')).rows;
    await move();expect((await db.query('select id,destination,client_id from dispatch_stops')).rows).toEqual(before);
    expect(await number('select count(*) value from dispatch_stop_documents where load_id=$1',[i.load2])).toBe(2);
    expect(await number('select count(*) value from dispatch_trip_loads where dispatch_trip_id=$1',[trip])).toBe(1);
    expect(await number('select count(*) value from loads where id=$1',[i.load])).toBe(0);
    expect((await db.query<{load_id:string}>('select load_id from dispatch_trips where id=$1',[trip])).rows[0].load_id).toBe(i.load2);
    expect(await number('select count(*) value from driver_settlements')).toBe(0);
  });
  it('preserves a nonempty source load and each stop when moving within the same planned trip',async()=>{
    await move([i.item2]);
    await db.query("insert into fiscal_documents(id,tenant_id,client_id,status) values($1,$2,$3,'confirmed')",[i.doc3,i.tenant,i.client]);
    await compositionRpc(db,'select public.upsert_load_item_v3(p_tenant_id=>$1,p_load_id=>$2,p_item_id=>null,p_quantity=>1,p_fiscal_document_id=>$3)',[i.tenant,i.load,i.doc3]);
    const payload=planningPayload();payload.load_ids=[i.load,i.load2];payload.stops[0].load_ids=[i.load,i.load2];payload.stops[0].fiscal_document_ids.push(i.doc3);
    await dispatchPlanning(db,payload);await move();
    expect(await number('select count(*) value from dispatch_trip_loads')).toBe(2);
    expect(await number('select count(*) value from load_items where load_id=$1',[i.load])).toBe(1);
    expect(await number('select count(*) value from dispatch_stop_documents where load_id=$1',[i.load])).toBe(1);
  });
  it('blocks all legacy composition mutation after a real departure even if load status is regressed',async()=>{
    const trip=await dispatchPlanning(db);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
    await compositionRpc(db,'select public.driver_start_trip($1)',[trip]);await db.query("update loads set status='loading' where id=$1",[i.load]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
    await unchanged(()=>move(),/load_locked/);
    await unchanged(()=>compositionRpc(db,'select public.upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>999)',[i.tenant,i.item]),/load_locked/);
    await unchanged(()=>compositionRpc(db,'select public.remove_fiscal_documents_from_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc]]),/load_locked/);
  });
  it('rejects a partial invoice transfer but accepts moving all its item rows together',async()=>{
    const third='91000000-0000-4000-8000-000000000003';
    await db.query('insert into load_items(id,tenant_id,load_id,fiscal_document_id,quantity) values($1,$2,$3,$4,1)',[third,i.tenant,i.load,i.doc]);
    await unchanged(()=>move(),/composition_document_split_not_allowed/);await move([i.item,third]);
    expect(await number('select count(*) value from load_items where fiscal_document_id=$1 and load_id=$2',[i.doc,i.load2])).toBe(2);
  });
  it('rejects mismatched fiscal mirror without attempting a silent repair',async()=>{
    await db.query('update fiscal_documents set load_id=null where id=$1',[i.doc]);await unchanged(()=>move(),/composition_document_mismatch/);
  });
  it('rejects direct cross-tenant item reassignment through the existing totals trigger',async()=>{
    await db.query('update loads set tenant_id=$1 where id=$2',[i.otherTenant,i.load2]);
    await unchanged(()=>db.query('update load_items set load_id=$1 where id=$2',[i.load2,i.item]),/load_item_ownership_mismatch/);
  });
  it('rejects a direct item/document tenant mismatch',async()=>{
    await db.query("insert into fiscal_documents(id,tenant_id,status) values($1,$2,'confirmed')",[i.doc3,i.otherTenant]);
    await unchanged(()=>db.query('update load_items set fiscal_document_id=$1 where id=$2',[i.doc3,i.item]),/load_item_ownership_mismatch/);
  });
  it('rejects direct tenant or item identity changes',async()=>{
    await unchanged(()=>db.query('update load_items set tenant_id=$1 where id=$2',[i.otherTenant,i.item]),/load_item_identity_immutable/);
    await unchanged(()=>db.query('update load_items set id=$1 where id=$2',['91000000-0000-4000-8000-000000000099',i.item]),/load_item_identity_immutable/);
  });
  it('keeps each function privilege exactly as captured',async()=>{
    for(const f of compositionContracts){
      const row=(await db.query('select has_function_privilege($1,$2,\'execute\') anon,has_function_privilege($3,$2,\'execute\') authenticated,has_function_privilege($4,$2,\'execute\') service_role',
        ['anon','public.'+f.signature,'authenticated','service_role'])).rows[0];
      expect(row).toEqual({anon:f.anon,authenticated:f.authenticated,service_role:f.service_role});
    }
  });
});
