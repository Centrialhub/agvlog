// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createReplanningDatabase,replanningIds as i,seedReplanning,twoPlannedTrips} from './helpers/replanningDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createReplanningDatabase();},30000);
beforeEach(async()=>{await seedReplanning(db);});afterAll(async()=>{await db?.close();});
const third='90000000-0000-4000-8000-000000000003';
describe('remaining captured document writers: reproduced defects, not desired behavior',()=>{
  it('adds an unassigned invoice to a planned load without assigning a delivery stop',async()=>{
    await twoPlannedTrips(db);await db.query("insert into fiscal_documents(id,tenant_id,status) values($1,$2,'confirmed')",[third,i.tenant]);
    await compositionRpc(db,'select assign_fiscal_documents_to_load_v2($1,$2,$3)',[i.tenant,i.load,[third]]);
    expect((await db.query('select count(*)::int n from load_items where fiscal_document_id=$1',[third])).rows[0]).toEqual({n:1});
    expect((await db.query('select count(*)::int n from dispatch_stop_documents where fiscal_document_id=$1',[third])).rows[0]).toEqual({n:0});
  });
  it('removes an invoice from a planned load but leaves the old stop document assignment',async()=>{
    const trips=await twoPlannedTrips(db);await compositionRpc(db,'select remove_fiscal_documents_from_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc]]);
    expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({load_id:null});
    expect((await db.query('select dispatch_stop_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({dispatch_stop_id:trips.sourceStop});
  });
  it('accepts a soft-deleted outbound document as incoming cargo',async()=>{
    await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,deleted_at) values($1,$2,'outbound','confirmed',now())",[third,i.tenant]);
    await compositionRpc(db,'select assign_fiscal_documents_to_load_v2($1,$2,$3)',[i.tenant,i.load,[third]]);
    expect((await db.query('select load_id from fiscal_documents where id=$1',[third])).rows[0]).toEqual({load_id:i.load});
  });
  it('deleting one of several items from an invoice explicitly clears the still-needed fiscal mirror',async()=>{
    const second='91000000-0000-4000-8000-000000000003';
    await db.query('insert into load_items(id,tenant_id,load_id,fiscal_document_id,quantity) values($1,$2,$3,$4,1)',[second,i.tenant,i.load,i.doc]);
    await compositionRpc(db,'select delete_load_item_v3($1,$2)',[i.tenant,second]);
    expect((await db.query('select count(*)::int n from load_items where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({n:1});
    expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({load_id:null});
  });
});
