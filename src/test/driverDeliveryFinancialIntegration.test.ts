// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDeliveryDocument, createDeliveryDatabase, deliveryDetails, deliveryIds as i,
  recordDelivery, seedDelivery } from './helpers/deliveryDatabase';
import { installDeliveryFinancialFixture } from './helpers/deliveryFinancialDatabase';

let db:PGlite;
beforeAll(async()=>{db=await createDeliveryDatabase();await installDeliveryFinancialFixture(db);},30000);
beforeEach(async()=>{
  await db.exec(`reset role;select set_config('qa.delivery_capture','off',false);
    truncate public.driver_settlements,public.driver_settlement_items,public.driver_settlement_events,
      public.driver_settlement_payments,public.driver_expenses,public.trip_routes,public.qa_delivery_side_effects;`);
  await seedDelivery(db);
  await db.exec(`update public.fiscal_documents set value=1000,freight_value=200,weight_kg=100,invoice_number='QA-1';
    update public.loads set load_number='QA-100',origin='Origem QA',destination='Destino QA',total_weight_kg=100;
    update public.dispatch_trips set notes='Rota sintética QA';`);
  await db.query(`insert into public.driver_expenses(tenant_id,dispatch_trip_id,driver_id,category,amount,approval_status,reimbursable)
    values($1,$2,$3,'meal',30,'approved',true),($1,$2,$3,'fuel',70,'approved',false),
      ($1,$2,$3,'toll',20,'pending',true),($1,$2,$3,'other',10,'rejected',true)`,[i.tenant,i.trip,i.driver]);
  await db.query(`insert into public.trip_routes(tenant_id,trip_id,geometry_geojson,distance_meters)
    values($1,$2,'{}',15000)`,[i.tenant,i.trip]);
});
afterAll(async()=>{await db?.close();});
async function asDriver(){await db.exec("select set_config('qa.delivery_capture','on',false);set role authenticated;");}
async function settlements(){await db.exec('reset role');return (await db.query<Record<string,unknown>>(
  'select *,loads_count::int,stops_count::int,documents_count::int from public.driver_settlements')).rows;}
async function count(table:string){return (await db.query<{count:number}>(`select count(*)::int count from public.${table}`)).rows[0].count;}
async function expectNoUnexpectedSideEffects(){
  await db.exec('reset role');expect(await count('qa_delivery_side_effects')).toBe(0);
  expect(await count('driver_settlement_payments')).toBe(0);
}

describe('delivery with captured production fiscal and settlement triggers',()=>{
  it('creates one pending-review settlement from final load/document states, without approving or paying',async()=>{
    await asDriver();await recordDelivery(db);
    const [settlement]=await settlements();
    expect(settlement).toMatchObject({status:'pending_review',needs_recalculation:false,recalculation_reason:null,
      loads_count:1,stops_count:1,documents_count:1,total_goods_value:'1000',total_freight_revenue:'200',
      approved_expenses_total:'100',pending_expenses_total:'20',rejected_expenses_total:'10',expenses_total:'130',
      driver_reimbursement_total:'30',driver_payable_amount:'30',total_paid_amount:'0',payment_balance:'30',route_result:'100',
      approved_by:null,approved_at:null,paid_by:null,paid_at:null,closed_by:null,closed_at:null});
    const snapshot=settlement.snapshot_json as {trip:{status:string};loads:{status:string}[];documents:{status:string}[]};
    expect(snapshot.trip.status).toBe('completed');expect(snapshot.loads[0].status).toBe('delivered');
    expect(snapshot.documents[0].status).toBe('delivered');
    expect(await count('driver_settlement_events')).toBe(1);
    expect(await count('driver_settlement_items')).toBe(7);
    await expectNoUnexpectedSideEffects();
    await asDriver();expect((await recordDelivery(db)).rows[0].result.replayed).toBe(true);
    expect(await settlements()).toHaveLength(1);expect(await count('driver_settlement_events')).toBe(1);
    expect(await count('driver_settlement_items')).toBe(7);await expectNoUnexpectedSideEffects();
  });
  it('does not create an early settlement when another delivery is still pending',async()=>{
    await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination)
      values($1,$2,$3,'pending','Outra parada QA')`,[i.stop2,i.tenant,i.trip]);
    await addDeliveryDocument(db,i.doc2,i.item2,i.load,i.stop2);
    await asDriver();expect((await recordDelivery(db)).rows[0].result.trip_completed).toBe(false);
    expect(await settlements()).toHaveLength(0);await expectNoUnexpectedSideEffects();
  });
  it('captures separate delivered/returned loads without treating both as fully delivered',async()=>{
    await db.query(`insert into public.loads(id,tenant_id,trip_id,status,load_number) values($1,$2,$3,'in_transit','QA-101')`,[i.load2,i.tenant,i.trip]);
    await db.query('insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[i.tenant,i.trip,i.load2]);
    await addDeliveryDocument(db,i.doc2,i.item2,i.load2,i.stop);
    await db.query('update public.fiscal_documents set value=500,freight_value=50,weight_kg=50 where id=$1',[i.doc2]);
    await asDriver();await recordDelivery(db,'partial_delivery',{...deliveryDetails,returned_items:{[i.item2]:10}});
    const [settlement]=await settlements();
    expect(settlement).toMatchObject({status:'pending_review',needs_recalculation:false,loads_count:2,documents_count:2,
      total_goods_value:'1500',total_freight_revenue:'250'});
    const snapshot=settlement.snapshot_json as {loads:{id:string;status:string}[]};
    expect(snapshot.loads).toEqual(expect.arrayContaining([expect.objectContaining({id:i.load,status:'delivered'}),
      expect.objectContaining({id:i.load2,status:'returned'})]));
    await expectNoUnexpectedSideEffects();
  });
  it('preserves adjustments and updates a draft instead of duplicating the settlement',async()=>{
    const existing=(await db.query<{id:string}>(`insert into public.driver_settlements(tenant_id,dispatch_trip_id,status)
      values($1,$2,'in_review') returning id`,[i.tenant,i.trip])).rows[0].id;
    await db.query(`insert into public.driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount)
      values($1,$2,'adjustment','credit',40),($1,$2,'adjustment','debit',5)`,[i.tenant,existing]);
    await asDriver();await recordDelivery(db);const rows=await settlements();expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:existing,status:'in_review',driver_credits_total:'40',driver_debits_total:'5',
      driver_payable_amount:'65',payment_balance:'65',needs_recalculation:false});
    expect((await db.query('select event_type from public.driver_settlement_events')).rows).toEqual([{event_type:'recalculated'}]);
    await expectNoUnexpectedSideEffects();
  });
  it('does not rewrite an already-approved settlement or create a financial obligation on delivery',async()=>{
    await db.query(`insert into public.driver_settlements(tenant_id,dispatch_trip_id,status,driver_payable_amount)
      values($1,$2,'approved',75)`,[i.tenant,i.trip]);
    // Approval is fixture setup, not a side effect of the driver operation.
    await db.exec('truncate public.qa_delivery_side_effects;');const before=await settlements();
    await asDriver();await recordDelivery(db);expect(await settlements()).toEqual(before);
    expect(await count('driver_settlement_events')).toBe(0);await expectNoUnexpectedSideEffects();
  });
  it('leaves no settlement/evidence when the entire delivery transaction is rolled back',async()=>{
    await db.exec('begin');await asDriver();await recordDelivery(db);
    expect(await settlements()).toHaveLength(1);await db.exec('rollback');
    expect(await settlements()).toHaveLength(0);expect(await count('proof_of_delivery')).toBe(0);
    expect(await count('operational_events')).toBe(0);expect(await count('dispatch_events')).toBe(0);
    expect((await db.query('select status from public.loads')).rows).toEqual([{status:'in_transit'}]);
    await expectNoUnexpectedSideEffects();
  });
  it.each(['delivered','failed','refused','returned','skipped','cancelled'])('does not release issued CT-e links for inbound result %s',async outcome=>{
    const issued='92000000-0000-4000-8000-000000000099';
    await db.query(`insert into public.fiscal_documents(id,tenant_id,load_id,document_type,status,sefaz_status)
      values($1,$2,$3,'outbound','authorized','authorized')`,[issued,i.tenant,i.load]);
    await db.query(`update public.fiscal_documents set cte_emitted_at=now(),cte_emitted_outbound_id=$1 where id=$2`,[issued,i.doc]);
    const before=(await db.query('select cte_emitted_at,cte_emitted_outbound_id from public.fiscal_documents where id=$1',[i.doc])).rows;
    await asDriver();await recordDelivery(db,outcome,deliveryDetails);await settlements();
    expect((await db.query('select cte_emitted_at,cte_emitted_outbound_id from public.fiscal_documents where id=$1',[i.doc])).rows).toEqual(before);
    expect((await db.query('select status,sefaz_status from public.fiscal_documents where id=$1',[issued])).rows).toEqual([{status:'authorized',sefaz_status:'authorized'}]);
    await expectNoUnexpectedSideEffects();
  });
});
