// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createManualExpenseCancellationDatabase} from './helpers/manualExpenseCancellationDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {manualExpenseResultSchema} from '@/lib/financial/manualExpenseContract';
import {manualExpenseCancellationPreviewSchema} from '@/lib/financial/manualExpenseCancellationContract';
let db:Awaited<ReturnType<typeof createManualExpenseCancellationDatabase>>;
beforeAll(async()=>{db=await createManualExpenseCancellationDatabase();
 const intake=readFileSync('supabase/migrations/20260909222851_finance_statement_intake.sql','utf8');
 for(const table of ['finance_bank_entries','finance_statement_rows']){const ddl=intake.match(new RegExp('create table public\\.'+table+'\\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw new Error(table);await db.exec(ddl);}
 await db.exec(readFileSync('supabase/migrations/20260909233625_finance_audit_queries.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910182406_finance_expense_cancellation_manual_audit.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20260910181549_finance_manual_expense_cancellation_preview.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function createExpense(){const request=randomUUID();const result=manualExpenseResultSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select record_finance_manual_expense($1) v',[{version:1,tenant_id:i.tenant,request_id:request,supplier_name:'Prestador conferido',category:'other',description:'Despesa avulsa da sede',amount_cents:2500,due_date:'2026-08-31',competence_date:'2026-08-15',reason:'Registro da despesa avulsa conferida'}])).rows[0].v);return {...result,originalRequest:request};}
async function preview(payable:string,actor=i.operator,tenant=i.tenant){return manualExpenseCancellationPreviewSchema.parse((await financeAs<{v:unknown}>(db,actor,'select preview_finance_manual_expense_cancellation($1,$2) v',[tenant,payable])).rows[0].v);}
it('resolves the original manual request by payable identity and preserves it after cancellation',async()=>{
 const original=await createExpense(),before=await preview(original.payable_id);
 expect(original.payable_id).not.toBe(original.originalRequest);expect(before).toMatchObject({payable_id:original.payable_id,original_request_id:original.originalRequest,eligible:true,can_execute:true,effects:{cost_removed_cents:'2500',obligation_cancelled_cents:'2500',cash_changed:false}});
 await financeAs(db,i.operator,'select cancel_finance_manual_expense($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:original.payable_id,revision:before.revision,reason:'Despesa avulsa duplicada identificada sem pagamento'}]);
 const after=await preview(original.payable_id);expect(after).toMatchObject({original_request_id:original.originalRequest,eligible:false,cancellation:{actor_id:i.operator,reason:'Despesa avulsa duplicada identificada sem pagamento'}});
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});expect((await db.query('select count(*)::int n from finance_expense_items')).rows[0]).toEqual({n:0});
});
it('never exchanges two equally valued manual expenses or accepts request IDs as payable IDs',async()=>{
 const a=await createExpense(),b=await createExpense();expect((await preview(a.payable_id)).original_request_id).toBe(a.originalRequest);expect((await preview(b.payable_id)).original_request_id).toBe(b.originalRequest);await expect(preview(a.originalRequest)).rejects.toThrow('finance_payable_not_found');
});
it('denies other tenants and drivers including mixed administrative membership',async()=>{
 const e=await createExpense();await expect(preview(e.payable_id,i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');await expect(preview(e.payable_id,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);await expect(preview(e.payable_id,i.driverUser)).rejects.toThrow('finance_access_denied');
});
it('keeps both real cancellation decisions permanently visible in manual-only audit',async()=>{
 const manual=await createExpense(),manualPreview=await preview(manual.payable_id),manualReason='Despesa manual duplicada, cancelamento conferido';
 const manualPayload={version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:manual.payable_id,revision:manualPreview.revision,reason:manualReason};
 await financeAs(db,i.operator,'select cancel_finance_manual_expense($1)',[manualPayload]);
 const item=randomUUID(),batchRequest=randomUUID(),batchReason='Gasto de lote duplicado, cancelamento conferido';
 await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[{version:1,tenant_id:i.tenant,request_id:batchRequest,context:'office',description:'Gasto da sede para auditoria',reason:'Registro original da compra da sede',items:[{id:item,category:'office',amount_cents:1500,occurred_on:'2026-08-15',description:'Compra duplicada de materiais',supplier_name:'Fornecedor auditado',payee_type:'supplier',no_receipt_reason:'Comprovante solicitado ao fornecedor',allocations:[]}]}]);
 const revision=(await db.query<{v:{revision:string}}>('select finance_private.expense_cancellation_context($1,$2) v',[i.tenant,item])).rows[0].v.revision;
 await financeAs(db,i.operator,'select cancel_finance_expense($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:item,revision,reason:batchReason}]);
 type Audit={total:number;manual_count:number;rows:{id:string;entity_type:string;entity_id:string;action:string;actor_id:string;actor_name:string;reason:string;manual_intervention:boolean;created_at:string}[]};
 const read=async()=>(await financeAs<{v:Audit}>(db,i.operator,'select list_finance_audit_events($1,$2) v',[i.tenant,{manual_only:true,actor_id:i.operator}])).rows[0].v;
 const before=await read();expect(before.total).toBe(2);expect(before.manual_count).toBe(2);
 expect(before.rows).toEqual(expect.arrayContaining([expect.objectContaining({entity_type:'payable',entity_id:manual.payable_id,action:'manual_expense_cancelled',actor_id:i.operator,actor_name:'Financeiro QA',reason:manualReason,manual_intervention:true}),expect.objectContaining({entity_type:'expense_item',entity_id:item,action:'expense_cancelled',actor_id:i.operator,actor_name:'Financeiro QA',reason:batchReason,manual_intervention:true})]));
 for(const row of before.rows){expect(row.id).toMatch(/^[0-9a-f-]{36}$/);expect(Number.isFinite(Date.parse(row.created_at))).toBe(true);}
 await financeAs(db,i.operator,'select cancel_finance_manual_expense($1)',[manualPayload]);expect(await read()).toEqual(before);
 await db.exec('savepoint immutable_audit');await expect(db.query('delete from finance_events where id=$1',[before.rows[0].id])).rejects.toThrow();await db.exec('rollback to savepoint immutable_audit');expect(await read()).toEqual(before);
 await expect(financeAs(db,i.driverUser,'select list_finance_audit_events($1,$2)',[i.tenant,{manual_only:true}])).rejects.toThrow('finance_access_denied');
});
