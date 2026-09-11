// @vitest-environment node
import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {it,expect} from 'vitest';
import {customerCreditRefundOptionsSchema,customerCreditRefundPreviewSchema,customerCreditRefundResultSchema} from '@/lib/financial/customerCreditRefundContract';
import {customerCreditPreviewSchema,customerCreditOptionsSchema} from '@/lib/financial/customerCreditContract';
import {createCustomerCreditRefundDatabase,seedCustomerCreditRefundSource} from './helpers/customerCreditRefundDatabase';import {financeIds as i} from './helpers/financeLedgerDatabase';import {operationRpc} from './helpers/operationOutcomeDatabase';
const candidate='supabase/migrations/20260911110629_finance_customer_credit_refund_public_catalog.sql';
interface Page{rows:Array<Record<string,unknown>>;total:number;next_offset:number|null;revision:string}
async function setup(publish=true){const db=await createCustomerCreditRefundDatabase();await db.exec('revoke all on function public.apply_client_invoice_command(jsonb) from public,anon,service_role;grant execute on function public.apply_client_invoice_command(jsonb) to authenticated');await db.exec(readFileSync('supabase/migrations/20260911103921_finance_customer_credit_public_catalog.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));if(publish)await db.exec(readFileSync(candidate,'utf8'));const source=await seedCustomerCreditRefundSource(db);return{db,source};}
it('paginates real eligible outgoing money, records/replays refund and keeps application UI backward compatible',async()=>{
 const{db,source}=await setup();try{
  const movements:string[]=[];for(let n=0;n<32;n++){const doc=n===31?'22333444000182':n===0?'11.222.333/0001-81':'11222333000181';movements.push((await db.query<{v:{movement_id:string}}>('select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:20000,occurred_on:source.day,description:'Refund candidate '+n,beneficiary_name:'Crédito para previsão',beneficiary_document:doc,reason:'Actual outgoing statement refund fixture'}])).rows[0].v.movement_id);}
  const options=async(q:Record<string,unknown>)=>customerCreditRefundOptionsSchema.parse((await operationRpc<{v:Page}>(db,'select get_finance_customer_credit_refund_options($1,$2,$3) v',[i.tenant,source.credit,{kind:'movements',search:'',offset:0,limit:30,expected_revision:null,...q}])).rows[0].v);
  const first=await options({});expect(first.total).toBe(31);expect(first.rows).toHaveLength(30);const last=await options({offset:30,expected_revision:first.revision});expect(last.rows).toHaveLength(1);expect(last.next_offset).toBe(null);if(first.kind!=='movements'||last.kind!=='movements')throw Error('Wrong kind');expect([...first.rows,...last.rows].some(r=>r.movement_id===movements[31])).toBe(false);
  const preview=(await operationRpc<{v:{revision:string;can_execute:boolean;credit:Record<string,unknown>}}>(db,'select preview_finance_customer_credit_refund($1,$2,$3,$4) v',[i.tenant,source.credit,movements[0],'10000'])).rows[0].v;customerCreditRefundPreviewSchema.parse(preview);expect(preview.can_execute).toBe(true);expect(preview).not.toHaveProperty('_evidence');expect(preview.credit).not.toHaveProperty('refund_history');
  const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:source.credit,outgoing_movement_id:movements[0],amount_cents:'10000',expected_revision:preview.revision,reason:'Bind only existing outgoing money to customer refund'};
  const bankBefore=(await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows;
  const send=async()=>(await operationRpc<{v:Record<string,unknown>}>(db,'select record_finance_customer_credit_refund($1) v',[payload])).rows[0].v;const result=customerCreditRefundResultSchema.parse(await send());expect(await send()).toEqual(result);expect(result).toMatchObject({cash_movement_created:false,amount_cents:'10000'});
  await expect(options({offset:30,expected_revision:first.revision})).rejects.toMatchObject({code:'40001'});const history=await options({kind:'history'});expect(history.rows).toHaveLength(1);expect(history.rows[0]).toMatchObject({outgoing_movement_id:movements[0],amount_cents:'10000'});expect(JSON.stringify(history)).not.toContain('source_snapshot');
  const appliedPreview=(await operationRpc<{v:{credit:Record<string,unknown>}}>(db,'select preview_finance_customer_credit_application($1,$2,$3,$4,null) v',[i.tenant,source.credit,source.target,'10000'])).rows[0].v;customerCreditPreviewSchema.parse(appliedPreview);expect(appliedPreview.credit).toMatchObject({returned_cents:'10000',available_cents:'50000'});expect(appliedPreview.credit).not.toHaveProperty('refund_history');
  const credits=(await operationRpc<{v:Page}>(db,'select get_finance_customer_credit_options($1,$2) v',[i.tenant,{kind:'credits'}])).rows[0].v;customerCreditOptionsSchema.parse(credits);expect(credits.rows[0]).toMatchObject({returned_cents:'10000',available_cents:'50000'});
  expect((await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows).toEqual(bankBefore);await db.exec('set constraints all immediate');
 }finally{await db.close();}
},30000);
it('denies anonymous, raw, cross-tenant and mixed users for refund catalog and public command',async()=>{
 const{db,source}=await setup();try{
  expect((await db.query<{v:boolean}>("select has_function_privilege('authenticated','finance_private.record_customer_credit_refund(jsonb)','execute') v")).rows[0].v).toBe(false);
  await db.exec('savepoint anonymous;set role anon');await expect(db.query('select get_finance_customer_credit_refund_options($1,$2,$3)',[i.tenant,source.credit,{kind:'history'}])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to anonymous;reset role');
  await expect(operationRpc(db,'select get_finance_customer_credit_refund_options($1,$2,$3)',[i.otherTenant,source.credit,{kind:'history'}])).rejects.toMatchObject({code:'42501'});
  await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(operationRpc(db,'select get_finance_customer_credit_refund_options($1,$2,$3)',[i.tenant,source.credit,{kind:'history'}])).rejects.toMatchObject({code:'42501'});await expect(operationRpc(db,'select record_finance_customer_credit_refund($1)',[{tenant_id:i.tenant}])).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);

it('refuses an altered void guard before any public refund API is created',async()=>{
 const{db}=await setup(false);try{
  await db.exec('savepoint wrong_guard;drop trigger a_customer_credit_refund_void on finance_movement_voids;create trigger a_customer_credit_refund_void before insert on finance_movement_voids for each row when(false) execute function finance_private.guard_customer_credit_refund()');
  await expect(db.exec(readFileSync(candidate,'utf8'))).rejects.toMatchObject({code:'55000',message:'finance_credit_refund_public_guard_changed:a_customer_credit_refund_void'});await db.exec('rollback to wrong_guard');
  expect((await db.query<{v:unknown}>("select to_regprocedure('public.record_finance_customer_credit_refund(jsonb)') v")).rows[0].v).toBe(null);
 }finally{await db.close();}
},30000);
