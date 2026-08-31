// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseCreationDatabase,creationCommand,creationContext,creationPayload} from './helpers/expenseCreationDatabase';
import {expenseCreationRelease} from './helpers/expenseCreationRelease';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await createExpenseCreationDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);});
afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
const enabled=async()=>(await db.query<{value:boolean}>("select has_function_privilege('authenticated','create_driver_expense_command(jsonb)','execute') value")).rows[0].value;
const snapshot=async()=>(await db.query<{result:unknown}>("select jsonb_build_object('expenses',(select jsonb_agg(e order by id) from driver_expenses e),'audit',(select jsonb_agg(a order by id) from driver_expense_creations a),'objects',(select jsonb_agg(o order by id) from storage.objects o),'payments',(select jsonb_agg(p order by id) from driver_settlement_payments p),'bank',(select jsonb_agg(b order by id) from bank_transactions b)) result")).rows[0].result;

describe('expense release containment and exact resumption',{timeout:15000},()=>{
 it('suspends before first use without reopening a legacy endpoint',async()=>{
  const p=await creationPayload(db,trip),before=await snapshot();await expenseCreationRelease(db,'contain');
  expect(await enabled()).toBe(false);await expect(creationContext(db,trip)).rejects.toThrow('suspended');
  await expect(creationCommand(db,p)).rejects.toThrow('permission denied');expect(await snapshot()).toEqual(before);
  await expenseCreationRelease(db,'resume');expect(await enabled()).toBe(true);await creationCommand(db,p);
  await expect(operationRpc(db,"select driver_create_expense($1,'food',25)",[trip])).rejects.toThrow('permission denied');
 });
 it('preserves committed receipts, audit and financial data while replay resumes exactly once',async()=>{
  const p=await creationPayload(db,trip);p.receipt={sha256:'a'.repeat(64),size:8,mime:'image/png'};p.fields.no_receipt=false;p.fields.no_receipt_reason='';
  const args=[i.tenant,i.user,p.request_id,'trip',trip,JSON.stringify(p.receipt)];
  const probe=(await db.query<{r:{path:string;metadata:unknown}}>('select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) r',args)).rows[0].r;
  await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[probe.path,JSON.stringify(probe.metadata)]);
  const result=await creationCommand(db,p),before=await snapshot();await expenseCreationRelease(db,'contain');
  const history=await operationRpc<{r:{total:number}}>(db,'select list_driver_expenses($1,0) r',[i.tenant]);expect(history.rows[0].r.total).toBe(1);
  const receipt=await operationRpc<{r:{uploaded:boolean}}>(db,'select get_expense_receipt_status($1,$2,$3,$4,$5::jsonb) r',[i.tenant,p.request_id,'trip',trip,JSON.stringify(p.receipt)]);expect(receipt.rows[0].r.uploaded).toBe(true);
  expect(await snapshot()).toEqual(before);await expenseCreationRelease(db,'resume');expect(await creationCommand(db,p)).toEqual(result);expect(await snapshot()).toEqual(before);
 });
 it('rejects a resume without the expected suspended permissions',async()=>{
  await expect(expenseCreationRelease(db,'resume')).rejects.toThrow('function or grants changed');expect(await enabled()).toBe(true);
 });
 it('requires a database owner rather than an authenticated API caller',async()=>{
  await db.exec('set role authenticated');try{await expect(expenseCreationRelease(db,'contain')).rejects.toThrow('function owner');}finally{await db.exec('reset role');}
  expect(await enabled()).toBe(true);
 });
 it.each([
  "alter function public.create_driver_expense_command(jsonb) set search_path=public",
  "grant execute on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) to authenticated",
  "grant execute on function public._guard_expense_creation_release() to anon",
  "alter table public.driver_expenses disable trigger guard_expense_creation_contract",
  "alter table public.driver_expenses drop constraint expense_creation_command_fkey",
  "grant execute on function public.driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean) to authenticated",
 ])('refuses contract drift without partial containment: %s',async sql=>{
  await db.exec(sql);await expect(expenseCreationRelease(db,'contain')).rejects.toThrow('Expense release refused');expect(await enabled()).toBe(true);
 });
 it('refuses changed code during suspension and does not bypass the internal guard through owner execution',async()=>{
  const p=await creationPayload(db,trip);await expenseCreationRelease(db,'contain');
  await db.exec('savepoint privileged_frame');try{await expect(db.query('select create_driver_expense_command($1::jsonb)',[JSON.stringify(p)])).rejects.toThrow('suspended');}finally{await db.exec('rollback to savepoint privileged_frame;release savepoint privileged_frame');}
  await db.exec("alter function public.create_driver_expense_command(jsonb) set search_path=public");await expect(expenseCreationRelease(db,'resume')).rejects.toThrow('function or grants changed');expect(await enabled()).toBe(false);
 });
});
