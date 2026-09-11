// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createReceivableFinancialDatabase,createFinancialScenario,financialPayload,financialCommand,reversalPayload,financialContext,receivableFinancialSql} from './helpers/receivableFinancialDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {installFinanceFiscalIntegrationFixture} from './helpers/financeFiscalIntegrationFixture';
let db:PGlite;
beforeAll(async()=>{
 ({db}=await createReceivableFinancialDatabase(true,false));
 await db.exec('create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');
 await db.query("insert into auth.users values($1,'financeiro@example.test','{\"full_name\":\"Financeiro QA\"}')",[i.operator]);
 await db.exec(readFileSync('supabase/migrations/20260909212104_finance_ledger_foundation.sql','utf8'));
 await installFinanceFiscalIntegrationFixture(db);
 await db.exec(readFileSync('supabase/migrations/20260910024438_finance_receivable_movement_projection.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910025658_finance_receipt_allocation_corrections.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910030634_finance_explicit_receipt_refunds.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910032730_finance_movement_receipt_trace.sql','utf8'));
 await db.exec('grant select,insert,update,delete on bank_transactions to authenticated;');
 await db.exec(readFileSync('supabase/migrations/20260910122628_finance_bank_transaction_browser_boundary.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
it('retains bank reads but denies direct browser mutation while canonical receipt recording still works',async()=>{
 expect((await db.query("select has_table_privilege('authenticated','bank_transactions','select') readable,has_table_privilege('authenticated','bank_transactions','insert') insertable,has_table_privilege('authenticated','bank_transactions','update') updatable,has_table_privilege('authenticated','bank_transactions','delete') deletable")).rows[0]).toEqual({readable:true,insertable:false,updatable:false,deletable:false});
 const s=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,s.receivable));
 await expect(operationRpc(db,'delete from bank_transactions')).rejects.toThrow('permission denied');expect((await db.query('select * from bank_transactions')).rows).toHaveLength(1);
});
it('projects a receipt exactly once in the same transaction and does not claim bank reconciliation',async()=>{
 const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);const result=await financialCommand(db,p);expect(await financialCommand(db,p)).toEqual(result);
 const movements=(await db.query('select direction,nature,amount_cents::text,bank_reference from finance_movements')).rows;
 expect(movements).toEqual([{direction:'in',nature:'receipt',amount_cents:'1000',bank_reference:null}]);
 expect((await db.query('select reconciliation_status from bank_transactions')).rows).toEqual([{reconciliation_status:'unmatched'}]);
 expect((await db.query('select payment_id,command_id,bank_transaction_id from finance_receivable_movement_links')).rows).toEqual([{payment_id:result.payment_id,command_id:result.command_id,bank_transaction_id:result.bank_transaction_id}]);
 await db.exec('set constraints all immediate');
});
it('preserves the original receipt and links a declared reversal without inventing bank confirmation',async()=>{
 const s=await createFinancialScenario(db);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const receipt=await financialCommand(db,await financialPayload(db,s.receivable));const p=reversalPayload(await financialPayload(db,s.receivable),receipt.payment_id!);
 const reversed=await financialCommand(db,p);expect(await financialCommand(db,p)).toEqual(reversed);
 expect((await db.query('select direction,amount_cents::text from finance_movements order by created_at')).rows).toEqual([{direction:'in',amount_cents:'1000'},{direction:'out',amount_cents:'1000'}]);
 expect((await db.query('select action from finance_receivable_movement_links order by created_at')).rows).toEqual([{action:'receive'},{action:'reverse'}]);
 expect((await db.query("select count(*)::int n from bank_transactions where reconciliation_status='matched'")).rows[0]).toEqual({n:0});
});
it('rolls back both books and the receipt if projection fails',async()=>{
 const s=await createFinancialScenario(db);
 await db.exec("create function qa_fail_projection() returns trigger language plpgsql as $$begin raise exception 'projection_failure';end;$$;create trigger qa_fail_projection before insert on finance_receivable_movement_links for each row execute function qa_fail_projection();");
 await expect(financialCommand(db,await financialPayload(db,s.receivable))).rejects.toThrow('projection_failure');
 for(const table of ['finance_movements','bank_transactions','receivables_payments','receivable_financial_commands'])expect((await db.query('select * from '+table)).rows).toHaveLength(0);
});
it('rejects a mixed driver profile without leaving a partial receipt or exposing links',async()=>{
 const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);
 await expect(financialCommand(db,p)).rejects.toThrow('finance_access_denied');
 expect((await operationRpc(db,'select * from finance_receivable_movement_links')).rows).toHaveLength(0);
 expect((await db.query('select * from receivables_payments')).rows).toHaveLength(0);
});
async function existingEntry(bank:string,date:string,amount=1500,direction='in'){
 return (await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'receipt',$4,$5,'Entrada registrada anteriormente','Cliente QA',$6) returning id",[i.tenant,bank,direction,amount,date,i.operator])).rows[0].id;
}
it('allocates one recorded entry over partial receipts without creating more cash',async()=>{
 const s=await createFinancialScenario(db),first=await financialPayload(db,s.receivable);const movement=await existingEntry(s.bank,first.effective_date);
 const command={...first,movement_id:movement};const ack=await financialCommand(db,command);expect(await financialCommand(db,command)).toEqual(ack);
 await financialCommand(db,await financialPayload(db,s.receivable,{movement_id:movement,amount_cents:500}));
 expect((await db.query('select amount_cents::text from finance_movements')).rows).toEqual([{amount_cents:'1500'}]);
 expect((await db.query('select movement_id from finance_receivable_movement_links')).rows).toEqual([{movement_id:movement},{movement_id:movement}]);
 await expect(financialCommand(db,await financialPayload(db,s.receivable,{movement_id:movement,amount_cents:1}))).rejects.toThrow('finance_receipt_movement_capacity_exceeded');
 expect((await db.query('select * from bank_transactions')).rows).toHaveLength(2);
 await expect(financialCommand(db,{...command,movement_id:crypto.randomUUID()})).rejects.toThrow('key_mismatch');
});
it.each(['direction','date','tenant'])('rejects an existing entry with incompatible %s',async variant=>{
 const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);
 const movement=await existingEntry(s.bank,variant==='date'?'2020-01-01':p.effective_date,1500,variant==='direction'?'out':'in');
 const selected=variant==='tenant'?crypto.randomUUID():movement;
 await expect(financialCommand(db,{...p,movement_id:selected})).rejects.toThrow('finance_receipt_movement_incompatible');
 expect((await db.query('select * from receivables_payments')).rows).toHaveLength(0);
});
it('corrects an allocation without creating a debit, then permits reallocation of the same entry',async()=>{
 const s=await createFinancialScenario(db);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const receipt=await financialCommand(db,await financialPayload(db,s.receivable));
 const movement=(await db.query<{id:string}>('select id from finance_movements')).rows[0].id;
 const command={version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),payment_id:receipt.payment_id,expected_revision:(await financialContext(db,s.receivable)).revision,reason:'Recebimento associado ao título errado'};
 const correct=async()=>(await operationRpc<{result:unknown}>(db,'select correct_finance_receipt_allocation($1::jsonb) result',[JSON.stringify(command)])).rows[0].result;
 const result=await correct();expect(result).toMatchObject({cash_changed:false,movement_id:movement});expect(await correct()).toEqual(result);
 expect((await financialContext(db,s.receivable)).received_cents).toBe(0);
 expect((await db.query('select * from bank_transactions')).rows).toHaveLength(1);expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
 await financialCommand(db,await financialPayload(db,s.receivable,{movement_id:movement}));expect((await financialContext(db,s.receivable)).received_cents).toBe(1000);
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
 const trace=(await operationRpc<{result:{total:number;rows:unknown[]}}>(db,'select get_finance_movement_receipt_trace($1,$2,1) result',[i.tenant,movement])).rows[0].result;
 expect(trace.total).toBe(2);
 expect(trace.rows).toEqual(expect.arrayContaining([expect.objectContaining({payment_id:receipt.payment_id,action:'receive',correction:expect.objectContaining({actor_id:i.operator,reason:command.reason})}),expect.objectContaining({correction:null})]));
 await expect(financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),receipt.payment_id!))).rejects.toThrow('finance_receipt_allocation_already_corrected');
});
it('scopes movement receipt history and denies mixed driver access',async()=>{
 const s=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,s.receivable));
 const movement=(await db.query<{id:string}>('select id from finance_movements')).rows[0].id;
 await expect(operationRpc(db,'select get_finance_movement_receipt_trace($1,$2,0)',[i.tenant,movement])).rejects.toThrow('finance_invalid_page');
 await expect(operationRpc(db,'select get_finance_movement_receipt_trace($1,$2,1)',[i.tenant,crypto.randomUUID()])).rejects.toThrow('finance_movement_not_found');
 await expect(operationRpc(db,'select get_finance_movement_receipt_trace($1,$2,1)',[crypto.randomUUID(),movement])).rejects.toThrow('finance_access_denied');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);
 await expect(operationRpc(db,'select get_finance_movement_receipt_trace($1,$2,1)',[i.tenant,movement])).rejects.toThrow('finance_access_denied');
});
it('paginates a movement shared by many receipts without hiding the total or repeating links',async()=>{
 const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable),movement=await existingEntry(s.bank,p.effective_date,1000);
 for(let index=0;index<21;index++)await financialCommand(db,await financialPayload(db,s.receivable,{movement_id:movement,amount_cents:1}));
 const page=async(n:number)=>(await operationRpc<{result:{total:number;rows:{command_id:string}[]}}>(db,'select get_finance_movement_receipt_trace($1,$2,$3) result',[i.tenant,movement,n])).rows[0].result;
 const first=await page(1),second=await page(2);expect(first.total).toBe(21);expect(second.total).toBe(21);expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(1);
 expect(new Set([...first.rows,...second.rows].map(row=>row.command_id)).size).toBe(21);expect((await page(3)).rows).toEqual([]);
});
it('requires an administrator and rolls back correction and title changes after a late failure',async()=>{
 const s=await createFinancialScenario(db),receipt=await financialCommand(db,await financialPayload(db,s.receivable));
 const command={version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),payment_id:receipt.payment_id,expected_revision:(await financialContext(db,s.receivable)).revision,reason:'Corrigir associação feita ao título incorreto'};
 const correct=()=>operationRpc(db,'select correct_finance_receipt_allocation($1::jsonb)',[JSON.stringify(command)]);
 await expect(correct()).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);command.expected_revision=(await financialContext(db,s.receivable)).revision;
 await db.exec("create function qa_fail_correction() returns trigger language plpgsql as $$begin raise exception 'correction_failure';end;$$;create trigger qa_fail_correction before insert on finance_commands for each row execute function qa_fail_correction();");
 await expect(correct()).rejects.toThrow('correction_failure');
 expect((await db.query('select * from finance_receipt_allocation_corrections')).rows).toHaveLength(0);expect((await financialContext(db,s.receivable)).received_cents).toBe(1000);
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
});
it('refuses a new reversal without explicit confirmation that money was returned',async()=>{
 const s=await createFinancialScenario(db);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const receipt=await financialCommand(db,await financialPayload(db,s.receivable));const confirmed=reversalPayload(await financialPayload(db,s.receivable),receipt.payment_id!);
 const {refund_kind:_,...unconfirmed}=confirmed;await expect(financialCommand(db,unconfirmed)).rejects.toThrow('financial_refund_confirmation_required');
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(1);
});
it('replays a reversal recorded before the explicit-refund requirement with its original response',async()=>{
 const {db:legacy}=await createReceivableFinancialDatabase(false);
 try{
  await legacy.exec(receivableFinancialSql());await legacy.exec('begin');const s=await createFinancialScenario(legacy);
  await legacy.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  const receipt=await financialCommand(legacy,await financialPayload(legacy,s.receivable));
  const {refund_kind:_,...oldCommand}=reversalPayload(await financialPayload(legacy,s.receivable),receipt.payment_id!);
  const original=await financialCommand(legacy,oldCommand);await legacy.exec(readFileSync('supabase/migrations/20260910030634_finance_explicit_receipt_refunds.sql','utf8'));
  expect(await financialCommand(legacy,oldCommand)).toEqual(original);expect((await legacy.query('select * from bank_transactions')).rows).toHaveLength(2);
 }finally{await legacy.close();}
},30000);
async function processFiscal(emission:string){
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;
 return (await operationRpc<{result:{status:string;issue:string|null;receivable_id:string}}>(db,'select process_finance_fiscal_observation($1,$2) result',[i.tenant,observation])).rows[0].result;
}
async function fiscalScenario(){
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const payer=crypto.randomUUID(),source=crypto.randomUUID(),emission=crypto.randomUUID();
 await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Pagador fiscal QA')",[payer,i.tenant]);
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,1000)',[source,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,source,'1'.repeat(44),'2'.repeat(15)]);
 const result=await processFiscal(emission);expect(result).toMatchObject({status:'applied',issue:null});
 await db.query("insert into bank_accounts(id,tenant_id,name) values('cf600000-0000-4000-8000-000000000001',$1,'Banco QA')",[i.tenant]);
 return {emission,receivable:result.receivable_id};
}
it('does not create fiscal credit from a receipt whose allocation was corrected',async()=>{
 const s=await fiscalScenario(),receipt=await financialCommand(db,await financialPayload(db,s.receivable));
 await operationRpc(db,'select correct_finance_receipt_allocation($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),payment_id:receipt.payment_id,expected_revision:(await financialContext(db,s.receivable)).revision,reason:'Corrigir a baixa antes do cancelamento fiscal'})]);
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[s.emission]);expect(await processFiscal(s.emission)).toMatchObject({status:'applied',issue:null});
 expect((await db.query('select * from finance_customer_credits')).rows).toHaveLength(0);expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
 expect(await financialContext(db,s.receivable)).toMatchObject({status:'cancelled',received_cents:0,open_cents:0});
});
it('preserves paid cash as fiscal credit and refuses a second release through correction',async()=>{
 const s=await fiscalScenario(),receipt=await financialCommand(db,await financialPayload(db,s.receivable));
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[s.emission]);expect(await processFiscal(s.emission)).toMatchObject({status:'applied',issue:null});
 expect((await db.query('select payment_id,amount_cents::text from finance_customer_credits')).rows).toEqual([{payment_id:receipt.payment_id,amount_cents:'1000'}]);
 await expect(operationRpc(db,'select correct_finance_receipt_allocation($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),payment_id:receipt.payment_id,expected_revision:(await financialContext(db,s.receivable)).revision,reason:'Tentativa de liberar novamente o valor do crédito'})])).rejects.toThrow('finance_correction_state_unavailable');
 expect((await db.query('select * from finance_receipt_allocation_corrections')).rows).toHaveLength(0);expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
 const options=(await operationRpc<{result:{total:number}}>(db,'select get_finance_receipt_movement_options($1,$2,$3,$4,$5) result',[i.tenant,'cf600000-0000-4000-8000-000000000001',(await financialPayload(db,s.receivable)).effective_date,'',1])).rows[0].result;
 expect(options.total).toBe(0);
});
it('does not create fiscal credit for money already returned to the payer',async()=>{
 const s=await fiscalScenario(),receipt=await financialCommand(db,await financialPayload(db,s.receivable));
 await financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),receipt.payment_id!));
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[s.emission]);expect(await processFiscal(s.emission)).toMatchObject({status:'applied',issue:null});
 expect((await db.query('select * from finance_customer_credits')).rows).toHaveLength(0);
 expect((await db.query('select direction,nature from finance_movements order by created_at')).rows).toEqual([{direction:'in',nature:'receipt'},{direction:'out',nature:'refund'}]);
});
it('blocks a receipt during cancellation review before the fiscal queue is processed',async()=>{
 const s=await fiscalScenario();await db.query("update hub_fiscal_emissions set status='cancel_processing' where id=$1",[s.emission]);
 expect(await financialContext(db,s.receivable)).toMatchObject({can_receive:false});
 await expect(financialCommand(db,await financialPayload(db,s.receivable))).rejects.toThrow('financial_action_requires_reconciliation_or_valid_state');
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);
});
