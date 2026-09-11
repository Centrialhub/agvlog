// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createPeriodMoneyPackageDatabase} from './helpers/periodMoneyPackageDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {periodMoneyPackageSchema} from '@/lib/financial/periodMoneyPackageContract';
let db:Awaited<ReturnType<typeof createPeriodMoneyPackageDatabase>>;
beforeAll(async()=>{db=await createPeriodMoneyPackageDatabase();},30000);beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência completa do período bancário'});
async function rpc<T>(name:string,p:unknown){return(await financeAs<{v:T}>(db,i.operator,`select ${name}($1::jsonb) v`,[p])).rows[0].v;}
async function prepareBank(){
 await seedAccountCloseStatement(db,'2026-07-31',10000);const statement=await seedAccountCloseStatement(db,'2026-08-31',11000,scope.from,scope.to,[{day:'2026-08-10',cents:1000}]);
 const movement=await rpc<{movement_id:string}>('record_finance_movement',{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:'2026-08-10',description:'Recebimento do cliente conferido no banco',beneficiary_name:'Cliente QA'});
 await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 const context=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3) v',[i.tenant,[movement.movement_id],statement.entryIds])).rows[0].v;
 await rpc('reconcile_finance_bank_group',{...base(),movement_ids:[movement.movement_id],bank_entry_ids:statement.entryIds,expected_revision:context.revision,account_evidence:'Conta e titular confirmados no documento do banco'});
 const readRevision=async(name:string)=>(await financeAs<{v:{revision:string}}>(db,i.operator,`select ${name}($1,$2,$3,$4) v`,[i.tenant,i.account,scope.from,scope.to])).rows[0].v.revision;
 await rpc('record_finance_account_opening',{...base(),...scope,revision:await readRevision('get_finance_statement_period_evidence')});
 await rpc('record_finance_statement_coverage_approval',{...base(),...scope,revision:await readRevision('get_finance_statement_coverage_review'),originals_obtained_from_bank:true,complete_period_confirmed:true});
 await rpc('review_finance_legacy_cut',{...base(),...scope,revision:await readRevision('get_finance_legacy_cut_review'),sources_reviewed:true});
 const closed=await rpc<{closure_id:string;revision:string}>('close_finance_account_period',{...base(),...scope,revision:await readRevision('preview_finance_account_period_close')});
 return{...closed,movement:movement.movement_id};
}
async function read(accounts=[i.account],from=scope.from,to=scope.to){return periodMoneyPackageSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_period_money_package($1,$2,$3,$4) v',[i.tenant,from,to,accounts])).rows[0].v);}
it('counts a reconciled receipt once across real bank evidence and the recorded movement while identifying excluded accounts',async()=>{
 const other=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,name,account_type,active) values($1,$2,'Caixa não selecionado','cash',false)",[other,i.tenant]);
 const closed=await prepareBank(),before=(await db.query('select * from finance_movements')).rows,r=await read();
 expect(r).toMatchObject({monetary_totals_valid:true,account_scope:{complete:false,excluded_ids:[other]},totals:{opening_cents:'10000',in_cents:'1000',out_cents:'0',closing_cents:'11000'}});
 expect(r.accounts[0].movement_ids).toEqual([closed.movement]);expect(r.accounts[0].closures[0]).toMatchObject({id:closed.closure_id,evidence_kind:'bank_statement',active:true,actor_id:i.operator});
 expect((await db.query('select * from finance_movements')).rows).toEqual(before);
 const incomplete=await read([i.account,other]);expect(incomplete.monetary_totals_valid).toBe(false);expect(incomplete.totals.closing_cents).toBeNull();expect(incomplete.accounts.find(a=>a.account_id===i.account)?.balances.closing_cents).toBe('11000');
});
it('does not trim a larger bank snapshot to another cut and preserves the closed history after a real reopening',async()=>{
 const closed=await prepareBank(),original=await read();const trimmed=await read([i.account],'2026-08-02',scope.to);expect(trimmed.monetary_totals_valid).toBe(false);expect(trimmed.accounts[0].issues).toContain('closure_crosses_requested_boundary');
 await rpc('reopen_finance_account_period',{...base(),closure_id:closed.closure_id,revision:closed.revision});
 const reopened=await read();expect(reopened.monetary_totals_valid).toBe(false);expect(reopened.totals.closing_cents).toBeNull();expect(reopened.revision).not.toBe(original.revision);expect(reopened.accounts[0].closures[0]).toMatchObject({id:closed.closure_id,active:false,reopening:{actor_id:i.operator}});
});
it('consolidates actual bank and physical cash closures without requiring a bank statement for cash',async()=>{
 const cash=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,name,account_type,active) values($1,$2,'Caixa físico da sede','cash',true)",[cash,i.tenant]);
 await prepareBank();
 await rpc('record_finance_cash_opening',{...base(),account_id:cash,effective_from:scope.from,custodian_name:'Financeiro da sede',counts:[{denomination_cents:1,quantity:5000}]});
 const counted=await rpc<{count_id:string}>('record_finance_cash_period_count',{...base(),account_id:cash,period_end:scope.to,counts:[{denomination_cents:1,quantity:5000}],custodian_name:'Financeiro da sede',counted_at_boundary:'end_of_day'});
 const cut=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_legacy_cut_review($1,$2,$3,$4) v',[i.tenant,cash,scope.from,scope.to])).rows[0].v;
 await rpc('review_finance_legacy_cut',{...base(),account_id:cash,from:scope.from,to:scope.to,revision:cut.revision,sources_reviewed:true});
 const preview=(await financeAs<{v:{revision:string}}>(db,i.operator,'select preview_finance_cash_period_close($1,$2,$3,$4,$5) v',[i.tenant,cash,scope.from,scope.to,counted.count_id])).rows[0].v;
 await rpc('close_finance_cash_period',{...base(),account_id:cash,from:scope.from,to:scope.to,count_id:counted.count_id,revision:preview.revision});
 const result=await read([i.account,cash]);expect(result).toMatchObject({monetary_totals_valid:true,account_scope:{complete:true},totals:{opening_cents:'15000',in_cents:'1000',out_cents:'0',closing_cents:'16000'}});
 expect(result.accounts.find(a=>a.account_id===cash)?.closures[0]).toMatchObject({evidence_kind:'cash_count',coverage_approval_id:null,count_id:counted.count_id});
 expect(result.accounts.find(a=>a.account_id===i.account)?.closures[0].evidence_kind).toBe('bank_statement');
});
