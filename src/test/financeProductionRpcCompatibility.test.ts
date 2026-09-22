// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceProductionRpcDatabase, productionCompatibilityMigration } from './helpers/financeProductionRpcDatabase';
import { expenseHistoryPageSchema } from '../lib/financial/expenseHistoryContract';
import { statementCursorListSchema } from '../lib/financial/statementHistoryContract';
import { fiscalQueuePageSchema as fiscalQueueSchema } from '../lib/financial/fiscalQueueContract';
import { payrollProjectionPageSchema } from '../lib/financial/payrollPaymentContract';
import { payableMovementOptionsSchema, payablePaymentHistorySchema } from '../lib/financial/payableMovementContract';

const i = Object.fromEntries(['tenant','otherTenant','actor','admin','mixed','account','targetAccount','payable','period','settlement','employee','entry','client','title','statement'].map((name,index)=>[name,`10000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
let db: PGlite;
beforeAll(async()=>{ db=await createFinanceProductionRpcDatabase(); },30000);
afterAll(async()=>{ await db?.close(); });
beforeEach(async()=>{
  await db.exec('begin');
  await db.exec(`
    insert into public.tenant_memberships(tenant_id,user_id,role,active) values
      ('${i.tenant}','${i.actor}','operator',true),('${i.tenant}','${i.admin}','admin',true),
      ('${i.tenant}','${i.mixed}','operator',true),('${i.tenant}','${i.mixed}','driver',true),
      ('${i.otherTenant}','${i.actor}','operator',true);
    insert into auth.users(id,email,raw_user_meta_data) values('${i.actor}','qa@example.test','{}');
    insert into public.bank_accounts(id,tenant_id,active,account_type,name) values
      ('${i.account}','${i.tenant}',true,'checking','Conta QA'),('${i.targetAccount}','${i.tenant}',true,'checking','Destino QA');
    insert into public.payables(id,tenant_id,amount,status,supplier_name) values('${i.payable}','${i.tenant}',100,'approved','Fornecedor QA');
    insert into public.payroll_periods(id,tenant_id,status,period_start,period_end) values('${i.period}','${i.tenant}','draft','2026-09-01','2026-09-30');
    insert into public.employees(id,tenant_id,name) values('${i.employee}','${i.tenant}','Colaborador QA');
    insert into public.payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,gross_amount,discount_amount,already_paid_amount,amount_to_pay,carryover_amount,source_summary,created_at)
      values('${i.entry}','${i.tenant}','${i.period}','${i.employee}','cancelled',0,0,0,0,0,'{}',now());
    insert into public.driver_settlements(id,tenant_id) values('${i.settlement}','${i.tenant}');
    insert into public.clients(id,tenant_id,company_name) values('${i.client}','${i.tenant}','Cliente QA');
    insert into public.receivables(id,tenant_id,client_id,status,amount,received_amount,due_date,created_at)
      values('${i.title}','${i.tenant}','${i.client}','pending',100,0,'2020-01-01',now());
    insert into public.client_portal_access(tenant_id,user_id,client_id,active,can_view_financial,can_download_documents)
      values('${i.tenant}','${i.actor}','${i.client}',true,true,false);
  `);
});
afterEach(async()=>{ await db.exec('rollback'); });

async function rpc(sql: string, params: unknown[]=[], actor=i.actor, tenant: string|null=i.tenant) {
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role:'authenticated',active_tenant_id:tenant})]);
  await db.exec('savepoint rpc; set role authenticated');
  try {
    const result=await db.query<{result: Record<string, unknown>}>(sql,params);
    await db.exec('reset role; release savepoint rpc');
    return result.rows[0].result;
  } catch(error) {
    await db.exec('rollback to savepoint rpc; release savepoint rpc');
    throw error;
  }
}
const approve=(request: string,actor=i.actor,tenant: string|null=i.tenant)=>rpc('select public.approve_payroll_period_v3($1,$2) result',[i.period,request],actor,tenant);
const close=(request: string,reason='Fechamento de teste',actor=i.admin)=>rpc('select public.close_payroll_period_v2($1,$2,$3) result',[i.period,reason,request],actor);

describe('production financial RPC compatibility',()=>{
  it('accepts explicit JSON null cursors on the first expense and statement pages',async()=>{
    expenseHistoryPageSchema.parse(await rpc('select public.list_finance_expense_page_v2($1,$2) result',[i.tenant,{page_size:30,cursor:null}]));
    statementCursorListSchema.parse(await rpc('select public.list_finance_statements_v2($1,$2) result',[i.tenant,{page_size:20,cursor:null}]));
    await expect(rpc('select public.list_finance_statements_v2($1,$2) result',[i.tenant,{cursor:{}}])).rejects.toThrow('finance_invalid_statement_filters');
    await expect(rpc('select public.list_finance_expense_page_v2($1,$2) result',[i.tenant,{cursor:{}}])).rejects.toThrow('finance_invalid_expense_filters');
  });
  it('executes the remaining additive read models against actual column definitions',async()=>{
    fiscalQueueSchema.parse(await rpc('select public.list_finance_fiscal_queue_v2($1) result',[i.tenant]));
    payrollProjectionPageSchema.parse(await rpc('select public.get_finance_payroll_entry_page($1,$2) result',[i.tenant,i.period]));
    expect(await rpc('select public.get_finance_receivables_page_v3($1) result',[i.tenant])).toMatchObject({version:3,total:1});
    expect(await rpc('select public.get_finance_settlement_expense_context_v2($1,$2) result',[i.tenant,i.settlement])).toMatchObject({version:1,total:0});
    expect(await rpc('select public.list_driver_expenses_for_review_v2($1) result',[i.tenant])).toMatchObject({version:2,total:0});
    expect(await rpc('select public.get_finance_legacy_reconciliation_summary($1,$2,$3,$4) result',[i.tenant,i.account,'2026-09-01','2026-09-30'])).toMatchObject({version:1,transaction_count:0});
    for(const kind of ['transactions','obligations']) expect(await rpc('select public.list_finance_legacy_reconciliation_rows($1,$2,$3,$4,$5) result',[i.tenant,i.account,'2026-09-01','2026-09-30',kind])).toMatchObject({kind,rows:[]});
  });
  it('returns populated expense and statement pages accepted by frontend schemas without duplicate cursor rows',async()=>{
    const batch=randomUUID();
    await db.query('insert into public.finance_expense_batches(id,tenant_id,context,description) values($1,$2,$3,$4)',[batch,i.tenant,'general','Despesas QA']);
    for(let n=0;n<3;n++){
      await db.query(`insert into public.finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,created_by,created_at)
        values($1,$2,$3,'other','Despesa QA',1000,'2026-09-01','Fornecedor QA',$4,now())`,[randomUUID(),i.tenant,batch,i.actor]);
      await db.query(`insert into public.finance_statement_imports(id,tenant_id,bank_account_id,file_name,file_hash,source_path,period_start,period_end,input_rows,created_at)
        values($1,$2,$3,'qa.ofx','hash','qa/path','2026-09-01','2026-09-30',0,now())`,[randomUUID(),i.tenant,i.account]);
    }
    for(const [name,schema] of [['list_finance_expense_page_v2',expenseHistoryPageSchema],['list_finance_statements_v2',statementCursorListSchema]] as const){
      const first=schema.parse(await rpc(`select public.${name}($1,$2) result`,[i.tenant,{page_size:2,cursor:null}]));
      expect(first.rows).toHaveLength(2);expect(first.has_more).toBe(true);
      const second=schema.parse(await rpc(`select public.${name}($1,$2) result`,[i.tenant,{page_size:2,cursor:first.next_cursor}]));
      expect(second.rows).toHaveLength(1);expect(second.has_more).toBe(false);
      expect(new Set([...first.rows,...second.rows].map(row=>row.id)).size).toBe(3);
    }
  });
  it('supports old and new payable arguments and rejects outdated revisions',async()=>{
    for(const name of ['get_finance_payable_movements','get_finance_payable_payment_history']) {
      const original=await rpc(`select public.${name}($1,$2) result`,[i.tenant,i.payable]);
      (name.endsWith('movements')?payableMovementOptionsSchema:payablePaymentHistorySchema).parse(original);
      expect(await rpc(`select public.${name}(_tenant_id=>$1,_payable_id=>$2,_expected_revision=>$3) result`,[i.tenant,i.payable,original.page_revision])).toEqual(original);
      await expect(rpc(`select public.${name}(_tenant_id=>$1,_payable_id=>$2,_expected_revision=>$3) result`,[i.tenant,i.payable,'0'.repeat(32)])).rejects.toThrow(/finance_payable_(options|history)_changed/);
    }
    const loads=await rpc('select public.list_available_loads_for_settlement_v2($1) result',[i.tenant]);
    expect(loads).toMatchObject({total:0,rows:[]});
    await expect(rpc('select public.list_available_loads_for_settlement_v2(_tenant_id=>$1,_expected_revision=>$2) result',[i.tenant,'changed'])).rejects.toThrow('settlement_snapshot_changed');
  });
  it('aligns overdue portal filtering with its revision and enforces portal access',async()=>{
    const result=await rpc("select public.portal_list_financial_titles_v2(_tenant_id=>$1,_status=>array['overdue']) result",[i.tenant]);
    expect(result).toMatchObject({total:1,rows:[{id:i.title,status:'overdue'}]});
    await db.query('update public.receivables set due_date=$1 where id=$2',['2999-01-01',i.title]);
    await expect(rpc("select public.portal_list_financial_titles_v2(_tenant_id=>$1,_status=>array['overdue'],_revision=>$2) result",[i.tenant,result.revision])).rejects.toThrow('financial_titles_revision_changed');
    expect(await rpc('select public.portal_list_financial_titles_v2($1) result',[i.tenant],i.admin)).toMatchObject({total:0,rows:[]});
  });
  it('persists failed approval diagnostics while preserving the legacy exception contract',async()=>{
    await db.query('insert into public.payroll_generation_issues(tenant_id,payroll_period_id,resolved) values($1,$2,false)',[i.tenant,i.period]);
    await expect(rpc('select public.approve_payroll_period($1) result',[i.period])).rejects.toThrow('finance_payroll_unresolved_generation_issues');
    expect(await approve(randomUUID())).toMatchObject({approved:false,issue_count:1});
    expect((await db.query('select status from public.payroll_periods')).rows).toEqual([{status:'draft'}]);
  });
  it('replays approval and close once, while checking actor, permissions and payload',async()=>{
    const approval=randomUUID();
    const approved=await approve(approval);
    expect(approved).toMatchObject({approved:true,issue_count:0});
    expect(await approve(approval)).toEqual(approved);
    await expect(approve(approval,i.admin)).rejects.toThrow('finance_request_actor_mismatch');
    await expect(approve(approval,i.actor,null)).rejects.toThrow('finance_access_denied');
    await expect(approve(approval,i.actor,i.otherTenant)).rejects.toThrow('finance_access_denied');
    const closing=randomUUID();
    const closed=await close(closing);
    expect(closed).toMatchObject({closed:true});
    expect(await close(closing)).toEqual(closed);
    await expect(close(closing,'Motivo alterado')).rejects.toThrow('request_payload_mismatch');
    await db.query("update public.tenant_memberships set role='operator' where user_id=$1",[i.admin]);
    await expect(close(closing)).rejects.toThrow('finance_access_denied');
    expect((await db.query('select count(*)::int n from finance_private.atomic_command_results')).rows[0]).toEqual({n:2});
  });
  it('denies driver/operator combinations and inactive company context on new reads',async()=>{
    for(const name of ['list_driver_expenses_for_review_v2','list_available_loads_for_settlement_v2','list_finance_expense_page_v2','list_finance_statements_v2','get_finance_receivables_page_v3']) {
      await expect(rpc(`select public.${name}($1) result`,[i.tenant],i.mixed)).rejects.toThrow('finance_access_denied');
      await expect(rpc(`select public.${name}($1) result`,[i.tenant],i.actor,i.otherTenant)).rejects.toThrow('finance_access_denied');
    }
  });
  it('reassigns statement account once, with one audit event and an unambiguous replay key',async()=>{
    await db.query('insert into public.finance_statement_imports(id,tenant_id,bank_account_id) values($1,$2,$3)',[i.statement,i.tenant,i.account]);
    await db.query('insert into public.finance_bank_entries(id,tenant_id,first_import_id,bank_account_id) values($1,$2,$3,$4)',[randomUUID(),i.tenant,i.statement,i.account]);
    const request=randomUUID();
    const command=()=>rpc('select public.reassign_finance_statement_account_v1($1,$2,$3,$4,$5) result',[i.tenant,i.statement,i.targetAccount,'Corrigir conta do extrato',request]);
    expect(await command()).toMatchObject({confirmed:true,bank_account_id:i.targetAccount});
    expect(await command()).toMatchObject({confirmed:true,request_id:request});
    expect((await db.query('select count(*)::int n from public.finance_events')).rows[0]).toEqual({n:1});
    expect((await db.query('select bank_account_id from public.finance_bank_entries')).rows).toEqual([{bank_account_id:i.targetAccount}]);
    await expect(rpc('select public.reassign_finance_statement_account_v1($1,$2,$3,$4,$5) result',[i.tenant,i.statement,i.account,'Outro motivo de correção',request])).rejects.toThrow('statement_account_reassignment_idempotency_mismatch');
  });
  it('can be replayed locally and retains legacy grants without exposing new RPCs to anon',async()=>{
    await db.exec(productionCompatibilityMigration);
    expect((await db.query("select has_function_privilege('authenticated','public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text)','EXECUTE') allowed")).rows[0]).toEqual({allowed:true});
    const exposed=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('approve_payroll_period_v3','close_payroll_period_v2','portal_list_financial_titles_v2','list_driver_expenses_for_review_v2') and has_function_privilege('anon',p.oid,'EXECUTE')");
    expect(exposed.rows).toEqual([]);
  });
});
