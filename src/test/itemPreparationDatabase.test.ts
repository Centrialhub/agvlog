// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createItemWriterDatabase,itemWriterIds as i,seedItemWriter} from './helpers/loadItemWriterDatabase';
import {compositionRpc} from './helpers/compositionDatabase';
import type {ItemPreparationPayload} from '@/lib/loads/itemPreparation';
let db:PGlite;
beforeAll(async()=>{db=await createItemWriterDatabase();},30000);
beforeEach(async()=>{await seedItemWriter(db);});afterAll(async()=>{await db?.close();});
const create=():ItemPreparationPayload&{request_id:string}=>({tenant_id:i.tenant,load_id:i.load,item_id:null,values:{item_description:'Carga manual',quantity:2,pallet_count:1,weight_kg:30},expected:null,request_id:i.request});
const update=()=>({...create(),item_id:i.item,values:{status:'loaded'},expected:{status:'pending'}});
const save=async(payload:unknown)=>((await compositionRpc(db,'select public.save_load_item_preparation($1::jsonb) result',[JSON.stringify(payload)])).rows[0] as {result:Record<string,unknown>}).result;
const state=async()=>JSON.stringify((await db.query("select jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by id) from load_items i),'loads',(select jsonb_agg(to_jsonb(l) order by id) from loads l),'audit',(select jsonb_agg(to_jsonb(a) order by id) from entity_audit_log a),'cache',(select jsonb_agg(to_jsonb(k) order by id) from idempotency_keys k),'documents',(select jsonb_agg(to_jsonb(d) order by id) from fiscal_documents d))")).rows);
async function reject(payload:unknown,pattern:RegExp){const before=await state();await expect(save(payload)).rejects.toThrow(pattern);expect(await state()).toBe(before);}

describe('recoverable item preparation API',()=>{
 it('creates once and replays exactly without a duplicate item or audit',async()=>{
  const payload=create(),result=await save(payload),before=await state();expect(result).toMatchObject({created:true,request_id:i.request,load_id:i.load,values:payload.values,totals_recalculated:true});
  expect(await save(payload)).toEqual(result);expect(await state()).toBe(before);
 });
 it('can recover confirmation even if the manually created item and load no longer exist',async()=>{
  const payload={...create(),load_id:i.load2};const result=await save(payload);
  await compositionRpc(db,'select delete_load_item_v3($1,$2)',[i.tenant,result.item_id]);
  expect((await db.query('select count(*)::int n from loads where id=$1',[i.load2])).rows[0]).toEqual({n:0});
  expect(await save(payload)).toEqual(result);
 });
 it('updates only after matching the value the user actually saw',async()=>{
  expect(await save(update())).toMatchObject({created:false,item_id:i.item,values:{status:'loaded'}});
  await reject({...update(),request_id:i.request2,values:{status:'picking'}},/expected_changed/);
 });
 it('preserves an unrelated concurrently edited field instead of overwriting the whole row',async()=>{
  await db.query("update load_items set notes='Outro operador' where id=$1",[i.item]);
  const result=await save(update());expect(result).toMatchObject({values:{status:'loaded',notes:'Outro operador'}});
 });
 it('rejects request-key reuse with another body',async()=>{
  await save(create());await reject({...create(),values:{quantity:10}},/idempotency_mismatch/);
 });
 it.each([
  {...update(),expected:null},
  {...update(),expected:{}},
  {...update(),expected:{status:'pending',tenant_id:i.tenant}},
  {...create(),expected:{}},
  {...create(),values:{fiscal_document_id:i.doc3}},
  {...create(),values:{quantity:'2'}},
  {...create(),values:{notes:null}},
  {...create(),values:{}},
 ])('rejects ambiguous or unsupported write contract %j without side effects',async(payload)=>{
  await reject(payload,/invalid_item_preparation/);
 });
 it('does not permit the public API to bypass physical outcome validation',async()=>{
  await reject({...update(),values:{status:'delivered'}},/requires_operational_outcome/);
 });
 it('revalidates membership for a previously committed request',async()=>{
  await save(create());await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await reject(create(),/not_authorized/);
 });
 it('rejects another tenant and preserves explicit API grants',async()=>{
  await reject({...create(),tenant_id:i.otherTenant},/not_authorized/);
  expect((await db.query("select has_function_privilege('anon','public.save_load_item_preparation(jsonb)','execute') anon,has_function_privilege('authenticated','public.save_load_item_preparation(jsonb)','execute') authenticated,has_function_privilege('service_role','public.save_load_item_preparation(jsonb)','execute') service_role")).rows[0]).toEqual({anon:false,authenticated:true,service_role:false});
 });
});
