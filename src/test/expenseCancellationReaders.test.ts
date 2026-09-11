// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createExpenseCancellationDatabase} from './helpers/expenseCancellationDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {expenseCancellationPreviewSchema} from '@/lib/financial/expenseCancellationContract';
let db:Awaited<ReturnType<typeof createExpenseCancellationDatabase>>;
beforeAll(async()=>{db=await createExpenseCancellationDatabase();await db.exec(readFileSync('supabase/migrations/20260909221405_finance_expense_history_queries.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20260910175733_finance_expense_cancellation_preview.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function createItems(size=1){const items=Array.from({length:size},(_,n)=>({id:randomUUID(),category:'office',description:`Material do escritório ${n}`,amount_cents:100,occurred_on:'2026-08-15',supplier_name:'Comércio conferido',no_receipt_reason:'Comprovante ainda não entregue',payee_type:'supplier',due_date:'2026-08-20',allocations:[]}));await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'office',description:'Compras conferidas da sede',reason:'Registro inicial de compras da sede',items}]);return items;}
async function preview(expense:string,actor=i.operator,tenant=i.tenant){return expenseCancellationPreviewSchema.parse((await financeAs<{v:unknown}>(db,actor,'select preview_finance_expense_cancellation($1,$2) v',[tenant,expense])).rows[0].v);}
async function history(filters:Record<string,unknown>={}){return expenseHistorySchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_expenses($1,$2) v',[i.tenant,filters])).rows[0].v);}
it('keeps cancelled expense history and removes its cost from complete totals across pages',async()=>{
 const items=await createItems(32),target=items[0].id,before=await preview(target);
 expect(before).toMatchObject({eligible:true,can_execute:true,effects:{cost_removed_cents:'100',obligation_cancelled_cents:'100',cash_changed:false}});
 await financeAs(db,i.operator,'select cancel_finance_expense($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:target,revision:before.revision,reason:'Despesa duplicada identificada antes do pagamento'}]);
 const first=await history(),second=await history({page:2}),rows=[...first.rows,...second.rows];
 expect(first).toMatchObject({total:32,active_count:31,cancelled_count:1,historical_total_cents:'3200',cancelled_total_cents:'100',total_cents:'3100',allocated_cents:'0',complement_cents:'3100',missing_receipt_count:31});
 expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(2);expect(rows.find(row=>row.id===target)).toMatchObject({amount_cents:100,cancelled:true,payable_status:'cancelled',cancellation:{actor_id:i.operator,reason:'Despesa duplicada identificada antes do pagamento'}});
 expect(first.categories).toEqual([{category:'office',amount_cents:'3100',item_count:31}]);expect(first.cost_centers[0]).toMatchObject({amount_cents:'3100',item_count:31});
 expect((await preview(target)).eligible).toBe(false);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
});
it('shows original value and cancellation evidence even when every filtered expense is cancelled',async()=>{
 const [item]=await createItems(),p=await preview(item.id);await financeAs(db,i.operator,'select cancel_finance_expense($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:item.id,revision:p.revision,reason:'Lançamento incorreto identificado na conferência'}]);
 expect(await history({search:item.description})).toMatchObject({total:1,active_count:0,cancelled_count:1,total_cents:'0',historical_total_cents:'100',cancelled_total_cents:'100',categories:[],cost_centers:[]});
});
it('rejects foreign or missing expenses and excludes driver access including mixed roles',async()=>{
 const [item]=await createItems();await expect(preview(item.id,i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');await expect(preview(randomUUID())).rejects.toThrow('finance_expense_not_found');await expect(preview(item.id,i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);await expect(preview(item.id,i.driverUser)).rejects.toThrow('finance_access_denied');
});
