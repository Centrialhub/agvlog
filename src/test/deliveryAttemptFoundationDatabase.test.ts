// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDeliveryAttemptDatabase,seedUndelivered,remainder,driverPartial,ownerStatement,attemptRow,insertAttempt} from './helpers/deliveryAttemptDatabase';
import {operationIds as i,operationRpc,operationPayload,recordOperation} from './helpers/operationOutcomeDatabase';
import {seedCorrectableOutcome,correctionPayload,correctOperation} from './helpers/operationCorrectionDatabase';
let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createDeliveryAttemptDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('delivery attempt foundation (activation deliberately closed)',()=>{
 it('keeps original allocations and null attempt identity without backfill',async()=>{
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:0});
  expect((await db.query('select delivery_attempt_id from load_items order by id')).rows).toEqual([{delivery_attempt_id:null},{delivery_attempt_id:null}]);
  expect((await db.query('select count(*)::int n from current_load_items')).rows[0]).toEqual({n:2});
  expect((await db.query('select count(*)::int n from current_dispatch_stop_documents')).rows[0]).toEqual({n:2});
 });
 it.each(['returned','refused','failed','not_delivered'])('computes the entire balance for %s without creating a new attempt',async(outcome)=>{
  const first=await seedUndelivered(db,stop,outcome);const result=await remainder(db,first.history_id);
  expect(result).toMatchObject({outcome,items:[{id:i.item,quantity:10,remaining_quantity:10}]});
  expect((await db.query('select status,load_id,current_delivery_attempt_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:outcome,load_id:i.load,current_delivery_attempt_id:null});
 });
 it('takes partial balance from the immutable correction event, not editable document metadata',async()=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop,'partial_delivery');payload.returned_items={[i.item]:0.25};
  const result=await correctOperation(db,payload);
  expect(await remainder(db,result.history_id)).toMatchObject({items:[{id:i.item,quantity:10,remaining_quantity:0.25}]});
 });
 it('calculates driver partial balances separately for notes delivered in the same event',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:0.25,[i.item2]:0.5});
  const histories=(await db.query<{id:string;fiscal_document_id:string}>('select id,fiscal_document_id from current_delivery_document_outcomes order by fiscal_document_id')).rows;
  for(const h of histories)expect(await remainder(db,h.id)).toMatchObject({items:[{remaining_quantity:h.fiscal_document_id===i.doc?0.25:0.5}]});
 });
 it('excludes fully delivered notes even when another note in the event has a balance',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:0.5});
  const delivered=(await db.query<{id:string}>('select id from current_delivery_document_outcomes where fiscal_document_id=$1',[i.doc2])).rows[0].id;
  await expect(ownerStatement(db,'select _delivery_redelivery_remainder($1)',[delivered])).rejects.toThrow('redelivery_requires_undelivered_balance');
 });
 it('rejects a superseded result and accepts only the latest correction',async()=>{
  const old=await seedUndelivered(db,stop);const updated=await correctOperation(db,await correctionPayload(db,stop,'refused'));
  await expect(ownerStatement(db,'select _delivery_redelivery_remainder($1)',[old.history_id])).rejects.toThrow('redelivery_requires_current_outcome');
  expect(await remainder(db,updated.history_id)).toMatchObject({outcome:'refused'});
 });
 it.each(['update','delete','insert'])('rejects a legacy %s of recorded items',async(action)=>{
  await seedUndelivered(db,stop);
  const sql=action==='update'?'update load_items set quantity=2 where id=$1':action==='delete'?'delete from load_items where id=$1':
   'insert into load_items(tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,status) select tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,status from load_items where id=$1';
  await expect(ownerStatement(db,sql,[i.item])).rejects.toMatchObject({code:'55000'});
  expect((await db.query('select quantity::float8 quantity from load_items where id=$1',[i.item])).rows[0]).toEqual({quantity:10});
 });
 it.each(['update','delete','insert'])('rejects a legacy %s of recorded stop allocations',async(action)=>{
  await seedUndelivered(db,stop);
  const sql=action==='update'?'update dispatch_stop_documents set load_id=null where fiscal_document_id=$1':action==='delete'?'delete from dispatch_stop_documents where fiscal_document_id=$1':
   'insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id) select tenant_id,dispatch_stop_id,fiscal_document_id,load_id from dispatch_stop_documents where fiscal_document_id=$1';
  await expect(ownerStatement(db,sql,[i.doc])).rejects.toMatchObject({code:'55000'});
 });
 it('does not let a manual item become a fiscal item through an UPDATE',async()=>{
  const row=(await db.query<{id:string}>("insert into load_items(tenant_id,load_id,item_description,quantity,pallet_count,status) values($1,$2,'Manual',1,0,'pending') returning id",[i.tenant,i.load])).rows[0];
  await expect(ownerStatement(db,'update load_items set fiscal_document_id=$1 where id=$2',[i.doc,row.id])).rejects.toMatchObject({code:'23514'});
 });
 it('keeps active item views automatically updatable for canonical pre-start writers',async()=>{
  const views=(await db.query('select table_name,is_updatable,is_insertable_into from information_schema.views where table_schema=\'public\' and table_name in(\'current_load_items\',\'current_dispatch_stop_documents\') order by table_name')).rows;
  expect(views).toEqual([{table_name:'current_dispatch_stop_documents',is_updatable:'YES',is_insertable_into:'YES'},{table_name:'current_load_items',is_updatable:'YES',is_insertable_into:'YES'}]);
 });
 it('preserves ordinary correction and completion without modifying old item quantities',async()=>{
  await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop,'returned'));
  const second=await operationPayload(db,stop,i.doc2);second.request_id=i.request2;await recordOperation(db,second);
  await db.exec('set constraints all immediate');
  expect((await db.query('select status from dispatch_trips where id=$1',[trip])).rows[0]).toEqual({status:'completed'});
  expect((await db.query('select count(*)::int n from driver_settlements')).rows[0]).toEqual({n:1});
  expect((await db.query('select sum(quantity)::float8 n from load_items')).rows[0]).toEqual({n:20});
 });
 it('returns current document state for an original stop allocation',async()=>{
  await seedUndelivered(db,stop);expect((await db.query('select status,load_id from delivery_allocation_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'returned',load_id:i.load});
 });
 it('allows insert/update/delete of an unrecorded stop allocation without assuming load-item columns',async()=>{
  const old=(await db.query<{id:string}>('delete from dispatch_stop_documents where fiscal_document_id=$1 returning id',[i.doc2])).rows[0].id;
  await db.query('insert into current_dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values($1,$2,$3,$4,$5)',[old,i.tenant,stop,i.doc2,i.load]);
  await db.query('update current_dispatch_stop_documents set load_id=load_id where id=$1',[old]);
  expect((await db.query('select delivery_attempt_id from dispatch_stop_documents where id=$1',[old])).rows[0]).toEqual({delivery_attempt_id:null});
 });
 it('validates an owner-created reservation against snapshots and remainder without advancing its head',async()=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);await insertAttempt(db,row);
  expect((await db.query('select current_delivery_attempt_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({current_delivery_attempt_id:null});
  expect((await operationRpc(db,'select id from delivery_attempts')).rows).toEqual([{id:row.id}]);
 });
 it.each(['source_document_snapshot','source_items_snapshot','financial_snapshot'])('rejects a forged %s',async(field)=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);
  await expect(insertAttempt(db,{...row,[field]:{forged:true}})).rejects.toMatchObject({code:'23514'});
 });
 it.each(['quantity','id','source_item_id','pallet_count','weight_kg','volume_m3','item_description','extra'])('rejects an invalid remainder template field: %s',async(field)=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);
  const invalid={quantity:999,id:i.item,source_item_id:i.item2,pallet_count:0.5,weight_kg:-1,volume_m3:-1,item_description:' ',extra:'injected'};
  await expect(insertAttempt(db,{...row,items:[{...row.items[0],[field]:invalid[field as keyof typeof invalid]}]})).rejects.toMatchObject({code:'23514'});
 });
 it('requires all of the remainder, not a subset or duplicate rows',async()=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);
  await expect(insertAttempt(db,{...row,items:[]})).rejects.toMatchObject({code:'23514'});
  await expect(insertAttempt(db,{...row,items:[row.items[0],row.items[0]]})).rejects.toMatchObject({code:'23514'});
 });
 it('keeps the reservation immutable and rejects a second consumption of the same outcome',async()=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);await insertAttempt(db,row);
  await expect(ownerStatement(db,'update delivery_attempts set reason=$1 where id=$2',['Outro motivo',row.id])).rejects.toMatchObject({code:'55000'});
  await expect(ownerStatement(db,'delete from delivery_attempts where id=$1',[row.id])).rejects.toMatchObject({code:'55000'});
  const second=await attemptRow(db,first.history_id);await expect(insertAttempt(db,second)).rejects.toMatchObject({code:'23505'});
 });
 it.each(['driver','foreign','inactive'])('restricts reservation reads and owner construction under a %s actor',async(actor)=>{
  const first=await seedUndelivered(db,stop);const row=await attemptRow(db,first.history_id);await insertAttempt(db,row);
  if(actor==='inactive')await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  else await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor==='driver'?i.user:'ab000000-0000-4000-8000-000000000099']);
  expect((await operationRpc(db,'select id from delivery_attempts')).rows).toEqual([]);
  await expect(insertAttempt(db,row)).rejects.toMatchObject({code:'23514'});
 });
 it('captures a nonzero existing financial record without recalculating or paying anything',async()=>{
  const first=await seedUndelivered(db,stop);const second=await operationPayload(db,stop,i.doc2);second.request_id=i.request2;await recordOperation(db,second);
  await db.exec("update driver_settlements set status='approved',driver_payable_amount=125,total_paid_amount=125");
  await db.query("insert into driver_settlement_payments(tenant_id,settlement_id,amount,payment_method,paid_by) select tenant_id,id,125,'pix',$1 from driver_settlements",[i.operator]);
  const row=await attemptRow(db,first.history_id);const before=JSON.stringify(row.financial_snapshot);await insertAttempt(db,row);
  expect(JSON.stringify((await db.query<{value:unknown}>('select _delivery_attempt_financial_snapshot($1,$2) value',[i.tenant,trip])).rows[0].value)).toBe(before);
 });
 it.each(['anon','authenticated','service_role'])('does not expose allocation projections or private helpers to %s',async(role)=>{
  const row=(await db.query<Record<string,boolean>>(`select has_function_privilege($1,'_delivery_redelivery_remainder(uuid)','execute') remainder,
   has_function_privilege($1,'_delivery_allocation_document(uuid)','execute') projection,
   has_function_privilege($1,'_guard_delivery_attempt_head()','execute') head,
   has_function_privilege($1,'_guard_delivery_allocation_rows()','execute') rows,
   has_function_privilege($1,'_delivery_attempt_activation_gate()','execute') gate,
   has_table_privilege($1,'delivery_attempts','insert') insert,
   has_table_privilege($1,'current_load_items','select') items,
   has_table_privilege($1,'delivery_allocation_documents','select') documents`,[role])).rows[0];
  expect(Object.values(row)).toEqual(Array(8).fill(false));
 });
 it('does not allow a browser to reset the document head',async()=>{
  await expect(operationRpc(db,'update fiscal_documents set current_delivery_attempt_id=$1 where id=$2',['ab000000-0000-4000-8000-000000000001',i.doc])).rejects.toMatchObject({code:'42501'});
 });
 it('keeps activation closed even for owner and legacy elevated writers',async()=>{
  await expect(ownerStatement(db,'update fiscal_documents set current_delivery_attempt_id=$1 where id=$2',['ab000000-0000-4000-8000-000000000001',i.doc])).rejects.toMatchObject({code:'55000'});
  await expect(ownerStatement(db,"insert into fiscal_documents(id,tenant_id,document_type,status,current_delivery_attempt_id) values(gen_random_uuid(),$1,'inbound','confirmed',$2)",[i.tenant,'ab000000-0000-4000-8000-000000000001'])).rejects.toMatchObject({code:'55000'});
 });
});
