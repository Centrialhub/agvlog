// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createReceivablePaymentsPageDatabase} from './helpers/receivablePaymentsPageDatabase';
import {withLegacyReceiptSeed} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {createFinancialScenario,financialCommand,financialPayload,reversalPayload,financialContext} from './helpers/receivableFinancialDatabase';
import {receivablePaymentsPageSchema} from '@/lib/financial/receivablePaymentsContract';
let db:PGlite;
beforeAll(async()=>{db=await createReceivablePaymentsPageDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where user_id=$1 and tenant_id=$2",[i.operator,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(id:string,page=1,revision:string|null=null,tenant=i.tenant){return receivablePaymentsPageSchema.parse((await operationRpc<{result:unknown}>(db,'select get_finance_receivable_payments_page($1,$2,$3,$4) result',[tenant,id,page,revision])).rows[0].result);}
it('returns all 505 historical payments with stable revision and exact paging',async()=>{
 const f=await createFinancialScenario(db);await db.exec('set constraints all immediate');
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,created_by) select gen_random_uuid(),$1,$2,0.01,'2026-01-01T15:00:00Z'::timestamptz,$3,'pix',$4 from generate_series(1,505)",[i.tenant,f.receivable,f.bank,i.operator]));
 const first=await read(f.receivable);expect(first.total).toBe(505);expect(first.rows).toHaveLength(50);
 const ids=first.rows.map(r=>r.id);for(let p=2;p<=11;p++)ids.push(...(await read(f.receivable,p,first.revision)).rows.map(r=>r.id));
 expect(ids).toHaveLength(505);expect(new Set(ids).size).toBe(505);expect(ids).toEqual([...ids].sort());
 expect(first.rows.every(r=>r.credit_id===null&&r.allocation_correction===null)).toBe(true);
 expect((await financialContext(db,f.receivable)).payments).toHaveLength(500);
});
it('includes real partial receipt and refund without hiding original and invalidates the revision',async()=>{
 const f=await createFinancialScenario(db),p=await financialCommand(db,await financialPayload(db,f.receivable,{amount_cents:1000}));
 const first=await read(f.receivable);expect(first.rows[0]).toMatchObject({id:p.payment_id,amount_cents:1000,reversed_at:null});
 await financialCommand(db,reversalPayload(await financialPayload(db,f.receivable),p.payment_id!));
 await expect(read(f.receivable,1,first.revision)).rejects.toThrow('finance_history_changed');
 const result=await read(f.receivable);expect(result.total).toBe(1);expect(result.rows[0].reversed_at).not.toBeNull();expect(result.rows[0].reversal_reason).toBe('Conferência financeira QA');
});
it('includes an actual allocation correction and changes revision when the account label changes',async()=>{
 const f=await createFinancialScenario(db),p=await financialCommand(db,await financialPayload(db,f.receivable,{amount_cents:1000}));
 const first=await read(f.receivable);
 await operationRpc(db,'select correct_finance_receipt_allocation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:p.payment_id,expected_revision:(await financialContext(db,f.receivable)).revision,reason:'Corrigir a alocação do recebimento'}]);
 const corrected=await read(f.receivable);expect(corrected.revision).not.toBe(first.revision);expect(corrected.rows[0].allocation_correction).toMatchObject({actor_id:i.operator,reason:'Corrigir a alocação do recebimento'});
 await db.query("update bank_accounts set name='Nome conferido' where id=$1",[f.bank]);await expect(read(f.receivable,1,corrected.revision)).rejects.toThrow('finance_history_changed');
 expect((await read(f.receivable)).rows[0].bank_account_name).toBe('Nome conferido');
});
it('requires revision for later pages, denies foreign/mixed-driver access, preserves ungranted internals',async()=>{
 const f=await createFinancialScenario(db);expect((await read(f.receivable)).rows).toEqual([]);
 await expect(read(f.receivable,2)).rejects.toThrow('finance_history_revision_required');await expect(read(f.receivable,0)).rejects.toThrow('finance_invalid_history_page');
 await expect(read(randomUUID())).rejects.toThrow('financial_receivable_not_found');await expect(read(f.receivable,1,null,i.otherTenant)).rejects.toThrow('finance_access_denied');
 expect((await db.query<{ok:boolean}>("select has_function_privilege('authenticated','finance_private.receivable_payment_page_rows(uuid,uuid)','execute') ok")).rows[0].ok).toBe(false);
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read(f.receivable)).rejects.toThrow('finance_access_denied');
});
it('preserves the original payment when a real fiscal cancellation releases customer credit',async()=>{
 const payer=randomUUID(),source=randomUUID(),emission=randomUUID(),bank='cf600000-0000-4000-8000-000000000001';
 await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Pagador fiscal QA')",[payer,i.tenant]);
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,1000)',[source,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,source,'1'.repeat(44),'2'.repeat(15)]);
 async function project(){return(await operationRpc<{result:{receivable_id:string;status:string}}>(db,'select process_finance_fiscal_observation($1,(select id from finance_fiscal_observations where emission_id=$2 order by observed_order desc limit 1)) result',[i.tenant,emission])).rows[0].result;}
 const projected=await project();expect(projected.status).toBe('applied');
 await db.query("insert into bank_accounts(id,tenant_id,name) values($1,$2,'Banco fiscal')",[bank,i.tenant]);
 const p=await financialCommand(db,await financialPayload(db,projected.receivable_id,{amount_cents:1000}));
 const before=await read(projected.receivable_id);expect(before.rows[0].credit_id).toBeNull();
 await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);await project();
 const result=await read(projected.receivable_id);expect(result.total).toBe(1);expect(result.rows[0]).toMatchObject({id:p.payment_id,amount_cents:1000,reversed_at:null});expect(result.rows[0].credit_id).not.toBeNull();expect(result.revision).not.toBe(before.revision);
});
it('invalidates a full-set revision after a newly inserted payment even if it sorts after page one',async()=>{
 const f=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,f.receivable));const before=await read(f.receivable);
 await financialCommand(db,await financialPayload(db,f.receivable,{effective_date:'2026-01-01'}));
 await expect(read(f.receivable,2,before.revision)).rejects.toThrow('finance_history_changed');expect((await read(f.receivable)).total).toBe(2);
});
