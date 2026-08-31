// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createCompositionDatabase,compositionIds as i,compositionRpc,seedComposition} from './helpers/compositionDatabase';
import {dispatchPlanning} from './helpers/planningDatabase';

let db:PGlite;
beforeAll(async()=>{db=await createCompositionDatabase();},30000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await seedComposition(db);});
const move=(ids=[i.item])=>compositionRpc(db,'select public.move_load_items_between_loads($1,$2,$3,$4) result',[i.tenant,i.load,i.load2,ids]);
describe('captured production composition defects reproduced locally',()=>{
  it('allows a tenant-A operator to move tenant-A items into a tenant-B load',async()=>{
    await db.query('update public.loads set tenant_id=$1 where id=$2',[i.otherTenant,i.load2]);
    await move();
    expect((await db.query<{mismatch:boolean}>('select i.tenant_id<>l.tenant_id mismatch from load_items i join loads l on l.id=i.load_id where i.id=$1',[i.item])).rows[0].mismatch).toBe(true);
    expect((await db.query<{load_id:string}>('select load_id from fiscal_documents where id=$1',[i.doc])).rows[0].load_id).toBe(i.load2);
  });
  it('adds an invoice to a planned load without adding it to any stop',async()=>{
    await dispatchPlanning(db);
    await db.query("insert into fiscal_documents(id,tenant_id,client_id,status) values($1,$2,$3,'confirmed')",[i.doc3,i.tenant,i.client]);
    await compositionRpc(db,'select public.assign_fiscal_documents_to_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc3]]);
    expect((await db.query<{count:number}>('select count(*)::int count from load_items')).rows[0].count).toBe(3);
    expect((await db.query<{count:number}>('select count(*)::int count from dispatch_stop_documents')).rows[0].count).toBe(2);
  });
  it('removes an invoice while a planned stop still references its former load',async()=>{
    await dispatchPlanning(db);
    await compositionRpc(db,'select public.remove_fiscal_documents_from_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc]]);
    expect((await db.query<{load_id:string|null}>('select load_id from fiscal_documents where id=$1',[i.doc])).rows[0].load_id).toBeNull();
    expect((await db.query<{load_id:string}>('select load_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0].load_id).toBe(i.load);
  });
  it('moves a planned invoice to another load without updating the stop assignment',async()=>{
    await dispatchPlanning(db);await move();
    expect((await db.query<{mismatch:boolean}>('select d.load_id<>f.load_id mismatch from dispatch_stop_documents d join fiscal_documents f on f.id=d.fiscal_document_id where f.id=$1',[i.doc])).rows[0].mismatch).toBe(true);
  });
  it('recalculates the target but leaves stale source totals after moving an item',async()=>{
    await move();
    const rows=(await db.query<{id:string;total_weight_kg:string}>('select id,total_weight_kg from loads order by id')).rows;
    expect(Number(rows.find(row=>row.id===i.load)?.total_weight_kg)).toBe(30);
    expect(Number(rows.find(row=>row.id===i.load2)?.total_weight_kg)).toBe(10);
    expect(Number((await db.query<{weight:string}>('select sum(weight_kg) weight from load_items where load_id=$1',[i.load])).rows[0].weight)).toBe(20);
  });
  it('reports partial success instead of rejecting a stale list of requested items',async()=>{
    const result=await move([i.item,'91000000-0000-4000-8000-000000000099']);
    expect(result.rows[0]).toMatchObject({result:{moved:1}});
  });
  it('lets composition change after departure when a load status was regressed but trip remains in_transit',async()=>{
    const trip=await dispatchPlanning(db);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
    await compositionRpc(db,'select public.driver_start_trip($1)',[trip]);
    await db.query("update loads set status='loading' where id=$1",[i.load]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
    await compositionRpc(db,'select public.upsert_load_item_v3(p_tenant_id=>$1,p_item_id=>$2,p_quantity=>999)',[i.tenant,i.item]);
    expect(Number((await db.query<{quantity:string}>('select quantity from load_items where id=$1',[i.item])).rows[0].quantity)).toBe(999);
  });
  it('automatic empty-document cleanup deletes remaining manual cargo when the last invoice is moved',async()=>{
    await db.query('update load_items set fiscal_document_id=null where id=$1',[i.item2]);
    await move();
    expect((await db.query<{count:number}>('select count(*)::int count from load_items where id=$1',[i.item2])).rows[0].count).toBe(0);
    expect((await db.query<{count:number}>('select count(*)::int count from loads where id=$1',[i.load])).rows[0].count).toBe(0);
  });
});
