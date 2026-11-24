// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { documentChangeIds } from './helpers/documentChangesDatabase';
import { createRedeliveryDatabase } from './helpers/redeliveryDatabase';
import { operationRpc } from './helpers/operationOutcomeDatabase';
import { planningPayload } from './helpers/planningDatabase';
import { driverPartial, seedUndelivered } from './helpers/deliveryAttemptDatabase';
let db:PGlite;
const i={...documentChangeIds,load:'74000000-0000-4000-8000-000000000001',doc3:'94000000-0000-4000-8000-000000000001'};
const migration=readFileSync('supabase/migrations/20261124194623_invoice_product_items.sql','utf8');
const products={version:1,items:[{line:1,code:'SAB',description:'Sabonete',quantity:12,unit:'CX',total:120},
  {line:2,code:'DES',description:'Desodorante',quantity:3,unit:'UN',total:60}]};
beforeAll(async()=>{const initial=await createRedeliveryDatabase();db=initial.db;
  await db.exec('begin');await seedUndelivered(db,initial.stop);await db.exec('commit');
  await db.exec('create schema if not exists private');
  await db.exec(migration);},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');
 await db.query("insert into loads(id,tenant_id,load_number,status) values($1,$2,'PRODUCTS-QA','planned')",[i.load,i.tenant]);
 await db.query("insert into fiscal_documents(id,tenant_id,document_type,status,invoice_number) values($1,$2,'inbound','confirmed','PRODUCTS-QA')",[i.doc3,i.tenant]);
});
afterEach(async()=>{await db.exec('rollback;reset role');});

async function attach(source:unknown=products){
  await db.query("update fiscal_documents set delivery_meta=jsonb_build_object('invoice_products',$2::jsonb),weight_kg=90,pallet_count=3 where id=$1",[i.doc3,JSON.stringify(source)]);
  return operationRpc(db,'select public.assign_fiscal_documents_to_load_v2($1,$2,$3) result',[i.tenant,i.load,[i.doc3]]);
}
it('expands a new invoice into separate selectable products while keeping invoice identity and transport totals',async()=>{
  await attach();
  const result=await db.query<{item_description:string;quantity:string;weight_kg:string;pallet_count:string;unit:string}>(
    "select item_description,quantity,weight_kg,pallet_count,source_product->>'unit' unit from load_items where fiscal_document_id=$1 order by (source_product->>'line')::integer",[i.doc3]);
  expect(result.rows.map(x=>[x.item_description,Number(x.quantity),x.unit])).toEqual([['Sabonete',12,'CX'],['Desodorante',3,'UN']]);
  expect(result.rows.reduce((n,x)=>n+Number(x.weight_kg),0)).toBe(90);
  expect(result.rows.reduce((n,x)=>n+Number(x.pallet_count),0)).toBe(3);
  expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc3])).rows).toEqual([{load_id:i.load}]);
});
it('rejects malformed product quantities atomically instead of manufacturing a whole-invoice product',async()=>{
  await expect(attach({...products,items:[{...products.items[0],quantity:0}]})).rejects.toThrow('invalid_invoice_product_line');
  expect((await db.query('select id from load_items where fiscal_document_id=$1',[i.doc3])).rows).toEqual([]);
  expect((await db.query('select load_id from fiscal_documents where id=$1',[i.doc3])).rows).toEqual([{load_id:null}]);
});
it('lets the assigned driver return only one imported product through the native outcome writer',async()=>{
  await attach();
  const payload=planningPayload();
  const next={...payload,idempotency_key:'b4000000-0000-4000-8000-000000000001',load_ids:[i.load],
    stops:[{...payload.stops[0],load_ids:[i.load],fiscal_document_ids:[i.doc3]}]};
  const trip=(await operationRpc<{trip:string}>(db,'select dispatch_planned_route($1::jsonb) trip',[JSON.stringify(next)])).rows[0].trip;
  const stop=(await db.query<{id:string}>('select id from dispatch_stops where dispatch_trip_id=$1',[trip])).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await operationRpc(db,'select driver_start_trip($1)',[trip]);
  await db.query("update dispatch_trips set actual_start_at=clock_timestamp()-interval '1 hour' where id=$1",[trip]);
  await db.query("update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp()-interval '5 minutes' where id=$1",[stop]);
  const read=(await operationRpc<{result:{items:Array<{id:string;product_code:string;quantity:number;unit:string}>}}>(db,'select get_driver_delivery_items($1) result',[stop])).rows[0].result;
  expect(read.items).toHaveLength(2);
  const deodorant=read.items.find(item=>item.product_code==='DES')!;
  expect(deodorant).toMatchObject({quantity:3,unit:'UN'});
  await driverPartial(db,trip,stop,{[deodorant.id]:1});
  const outcome=(await db.query<{items:Array<{id:string;remaining_quantity:number}>}>(
    'select (_delivery_redelivery_remainder(id))->\'items\' items from delivery_document_outcomes where fiscal_document_id=$1',[i.doc3])).rows[0];
  expect(outcome.items.map(item=>[item.id,item.remaining_quantity])).toEqual([[deodorant.id,1]]);
});
it('keeps pre-migration history readable without rewriting its immutable snapshot',async()=>{
  const result=await db.query<{items:unknown[]}>("select (_delivery_redelivery_remainder(id))->'items' items from delivery_document_outcomes where fiscal_document_id=$1",[i.doc]);
  expect(result.rows[0].items).toHaveLength(1);
});
it('does not duplicate products when the same document is assigned again',async()=>{
  await attach();await attach();
  expect((await db.query('select count(*)::integer n from load_items where fiscal_document_id=$1',[i.doc3])).rows).toEqual([{n:2}]);
});
it('preserves the operator and tenant boundary for product expansion',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(attach()).rejects.toThrow();
  expect((await db.query('select id from load_items where fiscal_document_id=$1',[i.doc3])).rows).toEqual([]);
});
