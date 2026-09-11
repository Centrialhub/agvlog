// @vitest-environment node
import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';
import {installPreparedReceiptCostPredecessors} from './helpers/preparedReceiptCostIntegrationDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
import {expenseCostOriginSchema} from '@/lib/financial/unloadingCostCorrectionContract';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {prepareReceiptImageCallback} from './helpers/preparedReceiptImageCallback';

let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);
afterAll(async()=>db?.close());
it('installs complete image evidence predecessors without changing an existing amended cost',async()=>{
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",[i.operator,JSON.stringify({active_tenant_id:i.tenant,role:'authenticated'}),JSON.stringify({'x-agvlog-tenant-id':i.tenant})]);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  const source=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);
  const preview=(await db.query<{v:{expense_id:string,payable_id:string,revision:string,eligible:boolean}}>('select finance_private.unloading_cost_correction_context($1,$2,$3) v',[i.tenant,source.charge_id,'12000'])).rows[0].v;
  expect(preview.eligible).toBe(true);
  await db.query('select finance_private.correct_unloading_cost($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:source.charge_id,expense_id:preview.expense_id,payable_id:preview.payable_id,amount_cents:'12000',revision:preview.revision,reason:'Retificação anterior à instalação do comprovante preparado'}]);
  const cost=async()=>expenseCostOriginSchema.parse((await db.query<{v:unknown}>('select finance_private.expense_cost_effective($1,$2) v',[i.tenant,preview.expense_id])).rows[0].v);
  const before=await cost();expect(before).toMatchObject({verified:true,effective_amount_cents:'12000'});
  const rows=async()=>(await db.query('select to_jsonb(e) expense,to_jsonb(c) charge from finance_expense_items e join finance_unloading_charges c on c.id=e.unloading_id')).rows;
  const original=await rows();
  await installPreparedReceiptCostPredecessors(db);
  expect(await rows()).toEqual(original);expect(await cost()).toEqual(before);
  const list=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);
  expect(list.rows[0].effective_amount_cents).toBe('12000');
  expect((await db.query("select has_function_privilege('authenticated','public.reserve_finance_upload_artifact(jsonb)','execute') reserve,has_function_privilege('authenticated','secure_upload_private.finalize(jsonb)','execute') finalize")).rows).toEqual([{reserve:true,finalize:false}]);
  const image=await prepareReceiptImageCallback(db,'expense_item',preview.expense_id);
  expect(image.reserved.usable).toBe(false);
  expect(await image.finalize()).toMatchObject({usable:true,state:'sanitized_derivative'});
  expect(await cost()).toEqual(before);
 }finally{await db.exec('rollback');}
},30000);
