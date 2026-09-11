// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {setupFinanceStatementIntakeDatabase} from './helpers/setupFinanceStatementIntakeDatabase';
import {statementListSchema,statementLinesSchema} from '@/lib/financial/statementHistoryContract';
import {identityCandidatesSchema} from '@/lib/financial/statementReviewContract';
import {financeAuditSchema} from '@/lib/financial/financeAuditContract';
import {reconciliationOptionsSchema,reconciliationContextSchema} from '@/lib/financial/reconciliationContract';
import {reconciliationHistorySchema} from '@/lib/financial/reconciliationHistoryContract';
import {statementIntakeResultSchema} from '@/lib/financial/statementImportContract';
import {nativeStatementAccountSchema} from '@/lib/financial/nativeStatementAccountContract';
import {automaticReconciliationSchema} from '@/lib/financial/automaticReconciliationContract';
import {accountPeriodSchema} from '@/lib/financial/accountPeriodContract';
import {ofxFile,ofxTransaction} from './helpers/financeOfxFixture';
import {readOfxStatement} from '../../supabase/functions/_shared/finance-ofx-reader';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
let db:PGlite;
beforeAll(async()=>{
  db=await setupFinanceStatementIntakeDatabase();
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
function row(bank_id:string|null=null,amount_cents=-50000){return {posted_on:'2026-01-01',amount_cents,bank_id,description:'PIX motorista',raw:{description:'PIX motorista'}};}
async function payload(rows:ReturnType<typeof row>[]){
  const hash=createHash('sha256').update(randomUUID()).digest('hex'),path=`${i.tenant}/imports/${hash}.csv`;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,'{\"size\":500,\"mimetype\":\"text/csv\"}')",[path]);
  return {version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,file_hash:hash,source_path:path,file_name:'extrato.csv',
    currency:'BRL',parser_version:'mapped-csv-v1',mapping:{date:'Data',amount:'Valor'},period_start:'2026-01-01',period_end:'2026-01-31',reason:'Extrato recebido para conferência',rows};
}
async function intake(p:Awaited<ReturnType<typeof payload>>,actor=i.operator){
  return (await financeAs<{result:{counts:Record<string,number>;import_id:string;source_verification:string}}>(db,actor,'select intake_finance_statement($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
}
describe('statement intake preserves multiplicity and quarantines uncertain identities',()=>{
  async function verifiedNativeSource(transactions=ofxTransaction('exact-reference')){
    const bytes=new TextEncoder().encode(ofxFile(transactions)),hash=createHash('sha256').update(bytes).digest('hex'),path=`${i.tenant}/imports/${hash}.ofx`;
    await db.query("update bank_accounts set bank_code='001',branch_number='1234',account_number='000123-4',account_type='checking' where id=$1",[i.account]);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,'{\"size\":1000,\"mimetype\":\"application/x-ofx\"}')",[path]);
    const command={...await payload([]),source_path:path,file_hash:hash,file_name:'nativo.ofx',parser_version:'native-ofx-v1',period_start:'2026-09-01',period_end:'2026-09-30',rows:readOfxStatement(bytes).rows};
    const source=statementIntakeResultSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select intake_finance_statement($1::jsonb) result',[JSON.stringify(command)])).rows[0].result);
    const context=(await financeAs<{result:StatementSourceContext}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,source.import_id])).rows[0].result;
    await verifyStatementSource({tenant:i.tenant,actor:i.operator,importId:source.import_id,request:randomUUID()},{inspect:async()=>context,download:async()=>bytes,workbook:async()=>{throw new Error('Unexpected workbook');},authorize:async()=>true,
      record:async report=>{await db.exec('set role service_role');const result=await db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify(report)]);await db.exec('reset role');return result;}});
    return source;
  }
  async function referenceMovement(amount=50000,date='2026-09-09',direction='out',reference='exact-reference'){
    return (await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,bank_reference,created_by) values($1,$2,$3,'payment',$4,$5,'Pagamento informado','Motorista',$6,$7) returning id",[i.tenant,i.account,direction,amount,date,reference,i.operator])).rows[0].id;
  }
  it('retires old reconciliation commands and protects their history while canonical reconciliation still works',async()=>{
    const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
    for(const name of ['bank_transactions','financial_obligations','financial_matches','bank_reconciliation_sessions']){
      const start=baseline.indexOf(`CREATE TABLE public.${name} (`),end=baseline.indexOf('\n);',start);
      expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(start);
      await db.exec(baseline.slice(start,end+3));
    }
    const signatures=[
      'run_bank_reconciliation(uuid,uuid,date,date)','accept_financial_match(uuid)','reject_financial_match(uuid,text)',
      'create_manual_financial_match(uuid,uuid,uuid,numeric,text)','reverse_financial_match(uuid,text)',
      '_apply_match_amounts(uuid,uuid,numeric)','close_reconciliation_session(uuid)',
    ];
    for(const signature of [...signatures,'sync_financial_obligations(uuid,date,date)']){
      const name=signature.split('(')[0],start=baseline.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),end=baseline.indexOf('$function$;',start);
      expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(start);
      await db.exec(baseline.slice(start,end+'$function$;'.length));
      await db.exec(`grant execute on function public.${signature} to authenticated,service_role`);
    }
    await db.exec('grant select,insert,update,delete on financial_matches to authenticated');
    await db.query("insert into financial_matches(id,tenant_id,bank_transaction_id,financial_obligation_id,amount_matched,match_type,status,reason,created_at,updated_at) values($1,$2,$3,$4,500,'manual','accepted','Motivo histórico',now(),now())",[randomUUID(),i.tenant,randomUUID(),randomUUID()]);
    const history=(await db.query('select * from financial_matches')).rows;
    const syncBefore=(await db.query("select prosrc from pg_proc where oid='public.sync_financial_obligations(uuid,date,date)'::regprocedure")).rows;
    const identities=(await db.query<{oid:number}>('select unnest($1::text[])::regprocedure::oid oid',[signatures])).rows;
    await db.exec(readFileSync('supabase/migrations/20260910124258_finance_retire_legacy_reconciliation.sql','utf8'));
    expect((await db.query('select * from financial_matches')).rows).toEqual(history);
    expect((await db.query("select prosrc from pg_proc where oid='public.sync_financial_obligations(uuid,date,date)'::regprocedure")).rows).toEqual(syncBefore);
    expect((await db.query('select unnest($1::text[])::regprocedure::oid oid',[signatures])).rows).toEqual(identities);
    for(const signature of signatures){
      for(const role of ['anon','authenticated','service_role'])expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed).toBe(false);
      const types=signature.slice(signature.indexOf('(')+1,-1).split(',');
      await db.exec('savepoint retired_command');
      await expect(db.query(`select public.${signature.split('(')[0]}(${types.map(type=>`null::${type}`).join(',')})`)).rejects.toThrow('finance_legacy_reconciliation_retired');
      await db.exec('rollback to savepoint retired_command');
    }
    expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','financial_matches','select') allowed")).rows[0].allowed).toBe(true);
    for(const command of ['insert','update','delete'])expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','financial_matches',$1) allowed",[command])).rows[0].allowed).toBe(false);
    await db.exec('savepoint immutable_history');
    await expect(db.exec('delete from financial_matches')).rejects.toThrow('finance_immutable_record');
    await db.exec('rollback to savepoint immutable_history');
    expect((await db.query('select * from financial_matches')).rows).toEqual(history);
    const movement=await referenceMovement();await verifiedNativeSource();
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
    const group=(await db.query<{id:string}>('select id from finance_reconciliation_groups')).rows[0];
    await financeAs(db,i.operator,'select reverse_finance_bank_reconciliation($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),group_id:group.id,reason:'Conferência após desativação do fluxo anterior'})]);
    expect((await db.query('select id from finance_movements')).rows).toEqual([{id:movement}]);
    expect((await db.query('select * from finance_reconciliation_reversals')).rows).toHaveLength(1);
  });
  it('matches a real native reference once without creating cash and never rematches a manual reversal',async()=>{
    const movement=await referenceMovement(),source=await verifiedNativeSource();
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
    const group=(await db.query<{id:string;method:string;movement_ids:string[];actor_id:string}>('select * from finance_reconciliation_groups')).rows[0];
    expect(group).toMatchObject({method:'automatic_reference',movement_ids:[movement],actor_id:i.operator});
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(0);
    const history=reconciliationHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_history($1,$2,1) result',[i.tenant,source.import_id])).rows[0].result);
    expect(history.rows[0]).toMatchObject({method:'automatic_reference',evidence_issue:null});
    await financeAs(db,i.operator,'select reverse_finance_bank_reconciliation($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),group_id:group.id,reason:'Revisão humana identificou associação incorreta'})]);
    await db.exec("update finance_automatic_reconciliation_jobs set status='pending',cursor_id=null");
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(0);
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(1);
  });
  it.each(['amount','date','direction','reference','duplicate','account','permission'])('refuses automatic matching with %s discrepancy',async variant=>{
    await referenceMovement(variant==='amount'?49999:50000,variant==='date'?'2026-09-08':'2026-09-09',variant==='direction'?'in':'out',variant==='reference'?'another-reference':'exact-reference');
    if(variant==='duplicate')await referenceMovement();
    await verifiedNativeSource();
    if(variant==='account')await db.query("update bank_accounts set account_number='123-4' where id=$1",[i.account]);
    if(variant==='permission')await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(0);
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(0);
    const job=(await db.query<{status:string;issue:string}>('select status,issue from finance_automatic_reconciliation_jobs')).rows[0];
    expect(job.issue||'').not.toContain('processing_error');
    expect(job.status).toBe(['account','permission'].includes(variant)?'review':'complete');
  });
  it.each(['reference','account'])('exposes later %s ambiguity without erasing the automatic decision',async variant=>{
    await referenceMovement();const source=await verifiedNativeSource();
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
    if(variant==='reference')await referenceMovement();
    else await db.query("insert into bank_accounts(id,tenant_id,active,name,bank_code,branch_number,account_number,account_type) values($1,$2,true,'Cadastro repetido','001','1234','000123-4','checking')",[randomUUID(),i.tenant]);
    const history=reconciliationHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_history($1,$2,1) result',[i.tenant,source.import_id])).rows[0].result);
    expect(history.rows[0]).toMatchObject({method:'automatic_reference',reversal:null,evidence_issue:variant==='reference'?'automatic_reference_ambiguous':'automatic_account_unconfirmed'});
  });
  it('revisits a completed scan when the missing outgoing record arrives later',async()=>{
    await verifiedNativeSource();
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(0);
    expect((await db.query<{status:string}>('select status from finance_automatic_reconciliation_jobs')).rows[0].status).toBe('complete');
    await referenceMovement();
    expect((await db.query<{status:string}>('select status from finance_automatic_reconciliation_jobs')).rows[0].status).toBe('pending');
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
  });
  it('keeps scheduler helpers inaccessible to browser roles',async()=>{
    await verifiedNativeSource();
    await expect(financeAs(db,i.operator,'select finance_private.run_automatic_reconciliation_queue()')).rejects.toThrow('permission denied');
    await expect(financeAs(db,i.driverUser,'select * from finance_automatic_reconciliation_jobs')).resolves.toMatchObject({rows:[]});
  });
  it('reports queue progress independently from complete reconciliation and denies unauthorized access',async()=>{
    const source=await verifiedNativeSource();
    const read=async()=>automaticReconciliationSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_automatic_reconciliation_status($1,$2) result',[i.tenant,source.import_id])).rows[0].result);
    expect(await read()).toMatchObject({status:'pending',matched_count:0,scheduler_active:false});
    await db.query('select finance_private.run_automatic_reconciliation_queue()');
    expect(await read()).toMatchObject({status:'complete',matched_count:0});
    await referenceMovement();await db.query('select finance_private.run_automatic_reconciliation_queue()');
    expect(await read()).toMatchObject({status:'complete',matched_count:1});
    await expect(financeAs(db,i.driverUser,'select get_finance_automatic_reconciliation_status($1,$2)',[i.tenant,source.import_id])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select get_finance_automatic_reconciliation_status($1,$2)',[i.otherTenant,source.import_id])).rejects.toThrow('finance_access_denied');
  });
  it.each(['repeated','conflicting'])('blocks matching when another native statement has %s references in quarantine',async kind=>{
    await referenceMovement();await verifiedNativeSource();
    const later=await verifiedNativeSource(kind==='repeated'?ofxTransaction('exact-reference')+ofxTransaction('exact-reference'):ofxTransaction('exact-reference','-501.00'));
    expect(later.counts).toHaveProperty(kind==='repeated'?'repeated_reference':'reference_conflict');
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(0);
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(0);
  });
  it('flags a later conflicting original without erasing the earlier automatic association',async()=>{
    await referenceMovement();const first=await verifiedNativeSource();
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
    await verifiedNativeSource(ofxTransaction('exact-reference','-501.00'));
    const history=reconciliationHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_history($1,$2,1) result',[i.tenant,first.import_id])).rows[0].result);
    expect(history.rows[0]).toMatchObject({method:'automatic_reference',reversal:null,evidence_issue:'automatic_bank_reference_contested'});
    expect(await periodReview()).toMatchObject({unresolved_row_count:1,evidence_review_count:1,unmatched_bank_count:1,unmatched_movement_count:1});
  });
  it('allows a consistent native overlap without counting the same money twice',async()=>{
    await referenceMovement();await verifiedNativeSource();
    const overlap=await verifiedNativeSource(ofxTransaction('exact-reference')+ofxTransaction('unrelated','-10.00'));
    expect(overlap.counts).toMatchObject({duplicate:1,new:1});
    expect((await db.query<{matched:number}>('select finance_private.run_automatic_reconciliation_queue() matched')).rows[0].matched).toBe(1);
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(1);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
  });
  async function periodReview(){return accountPeriodSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_account_period_review($1,$2,$3,$4) result',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rows[0].result);}
  it('shows offsetting inflow and outflow errors even when the net difference is zero',async()=>{
    await verifiedNativeSource(ofxTransaction('debit','-100.00')+ofxTransaction('credit','100.00').replace('DEBIT','CREDIT'));
    await referenceMovement(20000,'2026-09-09','out','debit');await referenceMovement(20000,'2026-09-09','in','credit');
    const result=await periodReview();expect(result.difference).toEqual({in_cents:'10000',out_cents:'10000',net_cents:'0'});
    expect(result).toMatchObject({unmatched_bank_count:2,unmatched_movement_count:2,unverified_entry_count:0,can_close:false,opening_balance_cents:null,closing_balance_cents:null});
  });
  it('counts a reconciled overlap once but never manufactures opening or closing balances',async()=>{
    await referenceMovement();await verifiedNativeSource();await verifiedNativeSource(ofxTransaction('exact-reference')+ofxTransaction('unrelated','-10.00'));
    await db.query('select finance_private.run_automatic_reconciliation_queue()');
    const result=await periodReview();expect(result.bank).toMatchObject({count:2,out_cents:'51000'});expect(result.recorded).toMatchObject({count:1,out_cents:'50000'});
    expect(result).toMatchObject({unmatched_bank_count:1,unmatched_movement_count:0,can_close:false,coverage_status:'pending'});
    await expect(financeAs(db,i.driverUser,'select get_finance_account_period_review($1,$2,$3,$4)',[i.tenant,i.account,'2026-09-01','2026-09-30'])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select get_finance_account_period_review($1,$2,$3,$4)',[i.tenant,i.otherAccount,'2026-09-01','2026-09-30'])).rejects.toThrow('finance_account_not_found');
    await expect(financeAs(db,i.operator,'select get_finance_account_period_review($1,$2,$3,$4)',[i.tenant,i.account,'2026-09-30','2026-09-01'])).rejects.toThrow('finance_invalid_period');
  });
  it('exposes a manual reconciliation crossing the requested accounting dates',async()=>{
    const movement=await referenceMovement(50000,'2026-08-31');await verifiedNativeSource();
    const entry=(await db.query<{id:string}>('select id from finance_bank_entries')).rows[0].id;
    const context=reconciliationContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3) result',[i.tenant,[movement],[entry]])).rows[0].result);
    await financeAs(db,i.operator,'select reconcile_finance_bank_group($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_ids:[movement],bank_entry_ids:[entry],expected_revision:context.revision,reason:'Registro interno anterior à data efetiva no banco',account_evidence:'Identificação da conta conferida no arquivo original'})]);
    expect(await periodReview()).toMatchObject({manual_group_count:1,cross_period_count:1,unmatched_bank_count:1,unmatched_movement_count:0,can_close:false});
  });
  it('compares native account evidence from the real reader without guessing missing digits or fields',async()=>{
    const bytes=new TextEncoder().encode(ofxFile('')),hash=createHash('sha256').update(bytes).digest('hex'),path=`${i.tenant}/imports/${hash}.ofx`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,'{\"size\":1000,\"mimetype\":\"application/x-ofx\"}')",[path]);
    const command={...await payload([]),source_path:path,file_hash:hash,file_name:'nativo.ofx',parser_version:'native-ofx-v1',period_start:'2026-09-01',period_end:'2026-09-30'};
    const source=statementIntakeResultSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select intake_finance_statement($1::jsonb) result',[JSON.stringify(command)])).rows[0].result);
    const read=async()=>nativeStatementAccountSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_native_statement_account($1,$2) result',[i.tenant,source.import_id])).rows[0].result);
    expect((await read()).status).toBe('source_unverified');
    const context=(await financeAs<{result:StatementSourceContext}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,source.import_id])).rows[0].result;
    await verifyStatementSource({tenant:i.tenant,actor:i.operator,importId:source.import_id,request:randomUUID()},{inspect:async()=>context,download:async()=>bytes,workbook:async()=>{throw new Error('Unexpected workbook');},authorize:async()=>true,
      record:async report=>{await db.exec('set role service_role');const result=await db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify(report)]);await db.exec('reset role');return result;}});
    expect((await read()).status).toBe('incomplete');
    await db.query("update bank_accounts set bank_code='001',branch_number='1234',account_number='000123-4',account_type='checking' where id=$1",[i.account]);
    const matching=await read();expect(matching.status).toBe('matched_exact');expect(matching.checks).toHaveLength(4);expect(matching.coverage_verification).toBe('pending');
    const duplicateAccount=randomUUID();await db.query("insert into bank_accounts(id,tenant_id,active,name,bank_code,branch_number,account_number,account_type) values($1,$2,true,'Cadastro repetido','001','1234','000123-4','checking')",[duplicateAccount,i.tenant]);
    expect(await read()).toMatchObject({status:'ambiguous',matching_account_count:2});await db.query('delete from bank_accounts where id=$1',[duplicateAccount]);
    await db.query("update bank_accounts set account_number='123-4' where id=$1",[i.account]);
    const mismatch=await read();expect(mismatch.status).toBe('mismatch');expect(mismatch.revision).not.toBe(matching.revision);
    expect(mismatch.checks.find(row=>row.field==='account_number')).toMatchObject({file_value:'000123-4',registered_value:'123-4',status:'different'});
    await db.query("update bank_accounts set account_number='000123-4',branch_number=null where id=$1",[i.account]);expect((await read()).status).toBe('incomplete');
    await expect(financeAs(db,i.driverUser,'select get_finance_native_statement_account($1,$2)',[i.tenant,source.import_id])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select get_finance_native_statement_account($1,$2)',[i.otherTenant,source.import_id])).rejects.toThrow('finance_access_denied');
  });
  it('preserves an empty native OFX without inventing money and still rejects an empty mapped statement',async()=>{
    const base=await payload([]),path=base.source_path.replace('.csv','.ofx');
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,'{\"size\":500,\"mimetype\":\"application/x-ofx\"}')",[path]);
    const command={...base,source_path:path,file_name:'saldo.ofx',parser_version:'native-ofx-v1'};
    const result=statementIntakeResultSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select intake_finance_statement($1::jsonb) result',[JSON.stringify(command)])).rows[0].result);
    expect(result.counts).toEqual({});expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(0);expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
    expect((await financeAs<{ready:boolean}>(db,i.operator,'select finance_statement_original_ready($1,$2,$3) ready',[i.tenant,base.file_hash,path])).rows[0].ready).toBe(true);
    await expect(intake(await payload([]))).rejects.toThrow('finance_invalid_statement');
  });
  it('paginates available reconciliation options and preserves literal search and source status',async()=>{
    const source=await intake(await payload([row('bank-unchecked')]));
    await db.query("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) select $1,$2,'out','payment',100,'2026-01-01','Pagamento 100% '||n,'Fornecedor',$3 from generate_series(1,23) n",[i.tenant,i.account,i.operator]);
    const read=async(kind:string,page:number,search='')=>reconciliationOptionsSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_options($1,$2,$3,$4,$5) result',[i.tenant,source.import_id,kind,search,page])).rows[0].result);
    const first=await read('movements',1),second=await read('movements',2);
    expect(first.total).toBe(23);expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows,...second.rows].map(row=>row.id)).size).toBe(23);
    expect((await read('movements',1,'%')).total).toBe(23);expect((await read('movements',1,'_')).total).toBe(0);
    expect((await read('entries',1)).rows[0]).toMatchObject({source_verified:false,amount_cents:'50000',direction:'out'});
    await expect(financeAs(db,i.driverUser,'select list_finance_reconciliation_options($1,$2,$3,$4,$5)',[i.tenant,source.import_id,'entries','',1])).rejects.toThrow('finance_access_denied');
  });
  it('reconciles a whole bank payment with several movements without creating money or losing manual provenance',async()=>{
    const source=await intake(await payload([row('pix-group')]));
    const entry=(await db.query<{id:string}>('select id from finance_bank_entries')).rows[0].id;
    const movements=[randomUUID(),randomUUID()];
    for(const [index,id] of movements.entries())await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'out','payment',$4,'2026-01-01','Pagamento informado','Motorista',$5)",[id,i.tenant,i.account,index===0?20000:30000,i.operator]);
    const context=async()=> reconciliationContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3) result',[i.tenant,movements,[entry]])).rows[0].result);
    const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_ids:movements,bank_entry_ids:[entry],expected_revision:(await context()).revision,
      reason:'Conferência do PIX único com os dois registros',account_evidence:'Conta do extrato conferida com o cadastro bancário'};
    const reconcile=async(command=p)=>(await financeAs<{result:{group_id:string;manual:boolean;amount_cents:string}}>(db,i.operator,'select reconcile_finance_bank_group($1::jsonb) result',[JSON.stringify(command)])).rows[0].result;
    await expect(reconcile()).rejects.toThrow('finance_reconciliation_source_not_verified');
    const snapshot=(await financeAs<{result:{revision:string;import_data:{file_hash:string}}}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,source.import_id])).rows[0].result;
    await db.exec('set role service_role');await db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify({tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:source.import_id,reader_version:'statement-source-v1',source_revision:snapshot.revision,file_hash:snapshot.import_data.file_hash,outcome:'rows_match',report:{hash_verified:true,matched_rows:1}})]);await db.exec('reset role');
    await expect(reconcile()).rejects.toThrow('finance_reconciliation_context_changed');
    p.expected_revision=(await context()).revision;
    await expect(financeAs(db,i.driverUser,'select reconcile_finance_bank_group($1::jsonb)',[JSON.stringify(p)])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3)',[i.otherTenant,movements,[entry]])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3)',[i.tenant,[movements[0],movements[0]],[entry]])).rejects.toThrow('finance_invalid_reconciliation_selection');
    for(const variant of [{amount:40000,direction:'out',otherAccount:false,error:'amount_mismatch'},{amount:50000,direction:'in',otherAccount:false,error:'account_or_direction_mismatch'},{amount:50000,direction:'out',otherAccount:true,error:'account_or_direction_mismatch'}]){
      await db.exec('savepoint invalid_reconciliation_case');
      const movement=randomUUID(),account=variant.otherAccount?randomUUID():i.account;
      if(variant.otherAccount)await db.query("insert into bank_accounts(id,tenant_id,active,name) values($1,$2,true,'Outra conta')",[account,i.tenant]);
      await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,$4,'payment',$5,'2026-01-01','Pagamento informado','Motorista',$6)",[movement,i.tenant,account,variant.direction,variant.amount,i.operator]);
      const selected=(await financeAs<{result:{revision:string}}>(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3) result',[i.tenant,[movement],[entry]])).rows[0].result;
      await expect(reconcile({...p,request_id:randomUUID(),movement_ids:[movement],expected_revision:selected.revision})).rejects.toThrow(`finance_reconciliation_${variant.error}`);
      await db.exec('rollback to savepoint invalid_reconciliation_case; release savepoint invalid_reconciliation_case');
    }
    const result=await reconcile();expect(result).toMatchObject({manual:true,amount_cents:'50000'});expect(await reconcile()).toEqual(result);
    for(const kind of ['entries','movements']){
      const options=reconciliationOptionsSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_options($1,$2,$3,$4,$5) result',[i.tenant,source.import_id,kind,'',1])).rows[0].result);
      expect(options.total).toBe(0);
    }
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(2);expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(1);
    expect((await db.query<{actor_id:string;actor_name:string}>('select actor_id,actor_name from finance_reconciliation_groups')).rows[0]).toEqual({actor_id:i.operator,actor_name:'Financeiro QA'});
    await expect(reconcile({...p,request_id:randomUUID(),expected_revision:(await context()).revision})).rejects.toThrow('finance_reconciliation_already_linked');
    const audit=financeAuditSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) result',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].result);
    expect(audit.rows.some(row=>row.action==='bank_reconciled_manually'&&row.manual_intervention)).toBe(true);
    expect((await financeAs(db,i.driverUser,'select * from finance_reconciliation_groups')).rows).toHaveLength(0);
    const reversePayload={version:1,tenant_id:i.tenant,request_id:randomUUID(),group_id:result.group_id,reason:'Vínculo selecionado incorretamente na conferência'};
    const reverse=async()=>(await financeAs<{result:unknown}>(db,i.operator,'select reverse_finance_bank_reconciliation($1::jsonb) result',[JSON.stringify(reversePayload)])).rows[0].result;
    const reversed=await reverse();expect(await reverse()).toEqual(reversed);
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(1);
    expect((await db.query('select * from finance_reconciliation_reversals')).rows).toHaveLength(1);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(2);
    expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(1);
    await expect(reconcile({...p,request_id:randomUUID()})).rejects.toThrow('finance_reconciliation_context_changed');
    const refreshed={...p,request_id:randomUUID(),expected_revision:(await context()).revision};
    expect((await reconcile(refreshed)).group_id).not.toBe(result.group_id);
    const history=async()=>reconciliationHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_reconciliation_history($1,$2,$3) result',[i.tenant,source.import_id,1])).rows[0].result);
    const records=await history();expect(records).toMatchObject({total:2,active_count:1});
    expect(records.rows[0]).toMatchObject({method:'manual',actor_id:i.operator,evidence_issue:null,movement_count:2,bank_entry_count:1});
    expect(records.rows.find(row=>row.id===result.group_id)?.reversal).toMatchObject({actor_id:i.operator,reason:reversePayload.reason});
    await db.query("update bank_accounts set account_number='999-1' where id=$1",[i.account]);
    expect((await history()).rows[0].evidence_issue).toBe('account_changed');
    await db.query('update bank_accounts set account_number=null where id=$1',[i.account]);
    expect((await history()).rows[0].evidence_issue).toBeNull();
    const latest=(await financeAs<{result:{revision:string;import_data:{file_hash:string}}}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,source.import_id])).rows[0].result;
    await db.exec('set role service_role');await db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify({tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:source.import_id,reader_version:'statement-source-v1',source_revision:latest.revision,file_hash:latest.import_data.file_hash,outcome:'rows_mismatch',report:{hash_verified:true,matched_rows:0}})]);await db.exec('reset role');
    expect((await history()).rows[0].evidence_issue).toBe('source_changed');
    expect((await db.query('select * from finance_reconciliation_groups')).rows).toHaveLength(2);
    await expect(financeAs(db,i.driverUser,'select list_finance_reconciliation_history($1,$2,$3)',[i.tenant,source.import_id,1])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select list_finance_reconciliation_history($1,$2,$3)',[i.otherTenant,source.import_id,1])).rejects.toThrow('finance_access_denied');
  });
  it('audits manual actions with literal filters, historical actors, local-day boundaries and full totals',async()=>{
    for(const date of ['2026-09-09T02:59:59Z','2026-09-09T03:00:00Z','2026-09-10T02:59:59Z','2026-09-10T03:00:00Z']){
      await db.query("insert into finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data,created_at) values($1,'statement_import',$2,'identity_review_reversed',$3,'Maria Financeiro','Revisão 100% conferida','{}',$4)",[i.tenant,randomUUID(),i.operator,date]);
    }
    const query=async(filters:object={},tenant=i.tenant,actor=i.operator)=>financeAuditSchema.parse((await financeAs<{result:unknown}>(db,actor,'select list_finance_audit_events($1,$2::jsonb) result',[tenant,JSON.stringify(filters)])).rows[0].result);
    const result=await query({from:'2026-09-09',to:'2026-09-09',page_size:1,manual_only:true,search:'%'});
    expect(result.total).toBe(2);expect(result.manual_count).toBe(2);expect(result.rows).toHaveLength(1);expect(result.rows[0].actor_name).toBe('Maria Financeiro');
    expect((await query({actor_id:i.operator,actor_search:'Maria'})).total).toBe(4);expect((await query({actor_search:'Financeiro QA'})).total).toBe(0);
    expect((await query({search:'_'})).total).toBe(0);
    await expect(query({},i.otherTenant)).rejects.toThrow('finance_access_denied');await expect(query({},i.tenant,i.driverUser)).rejects.toThrow('finance_access_denied');
  });
  it('records manual identity with permanent actor evidence, strict target checks and idempotent retry',async()=>{
    const first=await intake(await payload([row()])),second=await intake(await payload([row()]));
    const verify=async(importId:string)=>{
      const snapshot=(await financeAs<{result:{revision:string;import_data:{file_hash:string}}}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,importId])).rows[0].result;
      await db.exec('set role service_role');await db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify({tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:importId,reader_version:'statement-source-v1',source_revision:snapshot.revision,file_hash:snapshot.import_data.file_hash,outcome:'rows_match',report:{hash_verified:true,matched_rows:1}})]);await db.exec('reset role');
      return (await db.query<{id:string}>('select id from finance_statement_verifications where import_id=$1 order by created_at desc,id desc limit 1',[importId])).rows[0].id;
    };
    const rowId=(await db.query<{id:string}>('select id from finance_statement_rows where import_id=$1',[second.import_id])).rows[0].id;
    const target=(await db.query<{id:string}>('select id from finance_bank_entries')).rows[0].id;
    const candidates=async()=>identityCandidatesSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_identity_candidates($1,$2) result',[i.tenant,rowId])).rows[0].result);
    expect((await candidates()).rows[0]).toMatchObject({id:target,source_verified:false,file_name:'extrato.csv'});
    const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),row_id:rowId,bank_entry_id:target,decision:'same_transaction',reason:'Mesma transação confirmada nos dois arquivos',source_verification_id:randomUUID()};
    const review=async(command:Record<string,unknown>=p,actor=i.operator)=>(await financeAs<{result:Record<string,unknown>}>(db,actor,'select review_finance_statement_identity($1::jsonb) result',[JSON.stringify(command)])).rows[0].result;
    await expect(review()).rejects.toThrow('finance_statement_source_review_required');
    const verifiedSource=await verify(second.import_id);
    Object.assign(p,{source_verification_id:verifiedSource});
    await expect(review()).rejects.toThrow('finance_identity_target_unverified');await verify(first.import_id);
    expect((await candidates()).rows[0].source_verified).toBe(true);
    await expect(review({...p,bank_entry_id:randomUUID()})).rejects.toThrow('finance_identity_target_conflict');
    await expect(review(p,i.driverUser)).rejects.toThrow('finance_access_denied');
    const result=await review();expect(result).toMatchObject({manual:true,reconciliation_status:'pending',bank_entry_id:target});expect(await review()).toEqual(result);
    await expect(review({...p,request_id:randomUUID()})).rejects.toThrow('finance_statement_row_already_reviewed');
    const lines=statementLinesSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_statement_lines($1,$2) result',[i.tenant,second.import_id])).rows[0].result);
    expect(lines.rows[0].classification).toBe('ambiguous');expect(lines.rows[0].manual_review).toMatchObject({actor_name:'Financeiro QA',decision:'same_transaction'});
    const list=statementListSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_statements($1) result',[i.tenant])).rows[0].result);
    expect(list.rows.find(r=>r.id===second.import_id)).toMatchObject({identity_review_count:0,manual_review_count:1});
    const third=await intake(await payload([row('reused-reference')]));
    const thirdRow=(await db.query<{id:string}>('select id from finance_statement_rows where import_id=$1',[third.import_id])).rows[0].id;
    const distinct=await review({...p,request_id:randomUUID(),row_id:thirdRow,bank_entry_id:null,decision:'distinct_transaction',source_verification_id:await verify(third.import_id)});
    expect(distinct.bank_entry_id).not.toBe(target);expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(2);
    expect((await db.query<{bank_id:string|null}>('select bank_id from finance_bank_entries where id=$1',[distinct.bank_entry_id])).rows[0].bank_id).toBeNull();
    const reversePayload={version:1,tenant_id:i.tenant,request_id:randomUUID(),review_id:distinct.review_id,reason:'Identificação corrigida após revisar o arquivo'};
    const reverse=async(command=reversePayload,actor=i.operator)=>(await financeAs<{result:Record<string,unknown>}>(db,actor,'select reverse_finance_identity_review($1::jsonb) result',[JSON.stringify(command)])).rows[0].result;
    const fourth=await intake(await payload([row()]));
    const fourthRow=(await db.query<{id:string}>('select id from finance_statement_rows where import_id=$1',[fourth.import_id])).rows[0].id;
    const dependent=await review({...p,request_id:randomUUID(),row_id:fourthRow,bank_entry_id:distinct.bank_entry_id,source_verification_id:await verify(fourth.import_id)});
    await expect(reverse()).rejects.toThrow('finance_identity_review_has_dependents');
    await expect(reverse(reversePayload,i.driverUser)).rejects.toThrow('finance_access_denied');
    await reverse({...reversePayload,request_id:randomUUID(),review_id:dependent.review_id});
    const reversed=await reverse();expect(await reverse()).toEqual(reversed);
    expect((await db.query<{active:boolean}>('select finance_private.bank_entry_active($1,$2) active',[i.tenant,distinct.bank_entry_id])).rows[0].active).toBe(false);
    expect((await candidates()).rows.map(candidate=>candidate.id)).not.toContain(distinct.bank_entry_id);
    const afterReversal=await intake(await payload([row()]));
    expect((await db.query<{candidate_ids:string[]}>('select candidate_ids from finance_statement_rows where import_id=$1',[afterReversal.import_id])).rows[0].candidate_ids).not.toContain(distinct.bank_entry_id);
    const revertedLines=statementLinesSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_statement_lines($1,$2) result',[i.tenant,third.import_id])).rows[0].result);
    expect(revertedLines.rows[0].manual_review?.reversal).toMatchObject({actor_name:'Financeiro QA',reason:reversePayload.reason});
    await expect(review({...p,request_id:randomUUID(),row_id:thirdRow,bank_entry_id:null,decision:'distinct_transaction'})).rejects.toThrow('finance_identity_review_changed');
    const latest=await review({...p,request_id:randomUUID(),row_id:thirdRow,bank_entry_id:null,decision:'distinct_transaction',previous_review_id:distinct.review_id,source_verification_id:await verify(third.import_id)});
    expect(latest.bank_entry_id).toBe(distinct.bank_entry_id);expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(2);
    expect((await db.query<{active:boolean}>('select finance_private.bank_entry_active($1,$2) active',[i.tenant,distinct.bank_entry_id])).rows[0].active).toBe(true);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
    await expect(financeAs(db,i.operator,'delete from finance_statement_identity_reviews')).rejects.toThrow('permission denied');
  });
  it('lists scoped files with literal search and totals independent of pagination',async()=>{
    const first=await payload([row(),row()]);await intake({...first,file_name:'Janeiro 100%.csv'});
    await intake(await payload([row()]));
    const list=async(filters:object,tenant=i.tenant,actor=i.operator)=>statementListSchema.parse((await financeAs<{result:unknown}>(db,actor,
      'select list_finance_statements($1,$2::jsonb) result',[tenant,JSON.stringify(filters)])).rows[0].result);
    const page=await list({page:1,page_size:1});expect(page.total).toBe(2);expect(page.rows).toHaveLength(1);
    const literal=await list({search:'%'});expect(literal.total).toBe(1);expect(literal.rows[0]).toMatchObject({file_name:'Janeiro 100%.csv',counts:{new:2},source_verification:'pending'});
    expect((await list({from:'2026-02-01'})).total).toBe(0);
    await expect(list({},i.otherTenant)).rejects.toThrow('finance_access_denied');
    await expect(list({},i.tenant,i.driverUser)).rejects.toThrow('finance_access_denied');
  });
  it('retains line multiplicity, paginates candidates and exposes actor history without changing cash',async()=>{
    await intake(await payload(Array.from({length:7},()=>row())));
    const second=await intake(await payload([row(),row()]));
    const lines=async(filters:object,importId=second.import_id,actor=i.operator)=>statementLinesSchema.parse((await financeAs<{result:unknown}>(db,actor,
      'select list_finance_statement_lines($1,$2,$3::jsonb) result',[i.tenant,importId,JSON.stringify(filters)])).rows[0].result);
    const page=await lines({page:1,page_size:1,classification:'ambiguous'});
    expect(page.total).toBe(2);expect(page.row_amount_total_cents).toBe('-100000');expect(page.rows).toHaveLength(1);
    expect(page.rows[0].candidate_count).toBe(7);expect(page.rows[0].candidate_preview).toHaveLength(5);
    expect(page.history[0]).toMatchObject({actor_id:i.operator,actor_name:'Financeiro QA'});
    expect((await lines({page:2,page_size:1})).rows[0].id).not.toBe(page.rows[0].id);
    await expect(lines({},second.import_id,i.driverUser)).rejects.toThrow('finance_access_denied');
    await expect(lines({},randomUUID())).rejects.toThrow('finance_statement_not_found');
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
  });
  it('allows scoped recovery to check a stored original and preserves its user-facing name',async()=>{
    const p=await payload([row()]);
    const ready=async(actor=i.operator)=>(await financeAs<{ready:boolean}>(db,actor,'select finance_statement_original_ready($1,$2,$3) ready',[i.tenant,p.file_hash,p.source_path])).rows[0].ready;
    expect(await ready()).toBe(true);await expect(ready(i.driverUser)).rejects.toThrow('finance_access_denied');
    await intake({...p,file_name:'Extrato janeiro.csv'});
    expect((await db.query('select file_name from finance_statement_imports')).rows).toEqual([{file_name:'Extrato janeiro.csv'}]);
  });
  it('allows only the server worker to attest original rows and still leaves account/coverage pending',async()=>{
    const p=await payload([row('ref')]),first=await intake(p);
    const snapshot=(await financeAs<{result:{revision:string}}>(db,i.operator,'select inspect_finance_statement_source($1,$2) result',[i.tenant,first.import_id])).rows[0].result;
    const verification={tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:first.import_id,reader_version:'statement-source-v1',
      source_revision:snapshot.revision,file_hash:p.file_hash,outcome:'rows_match',report:{hash_verified:true,matched_rows:1}};
    await expect(financeAs(db,i.operator,'select record_finance_statement_verification($1::jsonb)',[JSON.stringify(verification)])).rejects.toThrow('permission denied');
    await db.exec('set role service_role');
    const query=()=>db.query<{result:Record<string,unknown>}>('select record_finance_statement_verification($1::jsonb) result',[JSON.stringify(verification)]);
    const result=(await query()).rows[0].result;expect((await query()).rows[0].result).toEqual(result);
    expect(result).toMatchObject({source_verification:'rows_match',account_coverage_verification:'pending'});
    await db.exec('reset role');expect((await db.query('select * from finance_statement_verifications')).rows).toHaveLength(1);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
  });
  it('rejects a stale worker snapshot and a worker request for a driver',async()=>{
    const p=await payload([row()]),first=await intake(p);
    const verification={tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),import_id:first.import_id,reader_version:'statement-source-v1',
      source_revision:'stale',file_hash:p.file_hash,outcome:'rows_match',report:{hash_verified:true,matched_rows:1}};
    await db.exec('savepoint worker;set role service_role');
    await expect(db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify(verification)])).rejects.toThrow('verification_changed');
    await db.exec('rollback to savepoint worker;set role service_role');
    await expect(db.query('select record_finance_statement_verification($1::jsonb)',[JSON.stringify({...verification,actor_id:i.driverUser})])).rejects.toThrow('finance_access_denied');
    await db.exec('rollback to savepoint worker');
  });
  it('keeps identical legitimate rows within a file and never creates declared movements',async()=>{
    const p=await payload([row(),row()]);const result=await intake(p);expect(result.counts).toEqual({new:2});expect(await intake(p)).toEqual(result);
    expect(result.source_verification).toBe('pending');
    expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(2);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
  });
  it('deduplicates a stable reference across overlapping files without deleting its source occurrences',async()=>{
    await intake(await payload([row('bank-ref-1')]));const result=await intake(await payload([row('bank-ref-1')]));
    expect(result.counts).toEqual({duplicate:1});expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(1);
    expect((await db.query('select * from finance_statement_rows')).rows).toHaveLength(2);
  });
  it('quarantines conflicting amounts under the same bank identifier',async()=>{
    await intake(await payload([row('bank-ref-1')]));expect((await intake(await payload([row('bank-ref-1',-51000)]))).counts).toEqual({reference_conflict:1});
    expect((await db.query('select amount_cents::int amount from finance_bank_entries')).rows).toEqual([{amount:-50000}]);
  });
  it('quarantines every repeated native identifier inside one file',async()=>{
    expect((await intake(await payload([row('ref'),row('ref')]))).counts).toEqual({repeated_reference:2});
    expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(0);
  });
  it('retains anonymous overlap for review instead of silently dropping or duplicating it',async()=>{
    await intake(await payload([row(),row()]));expect((await intake(await payload([row()]))).counts).toEqual({ambiguous:1});
    const pending=(await db.query<{candidate_ids:string[]}>('select candidate_ids from finance_statement_rows where classification=\'ambiguous\'')).rows[0];
    expect(pending.candidate_ids).toHaveLength(2);expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(2);
  });
  it('keeps equal transactions when both carry different reliable identifiers',async()=>{
    await intake(await payload([row('ref1')]));expect((await intake(await payload([row('ref2')]))).counts).toEqual({new:1});
  });
  it('retires the legacy import without changing existing evidence or breaking canonical intake and replay',async()=>{
    const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
    const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.import_bank_statement(');
    expect(start).toBeGreaterThan(-1);
    const end=baseline.indexOf('$function$;',start);
    expect(end).toBeGreaterThan(start);
    await db.exec(baseline.slice(start,end+'$function$;'.length));
    const signature='public.import_bank_statement(uuid,uuid,text,text,date,date,jsonb,jsonb)';
    await db.exec(`grant execute on function ${signature} to authenticated,service_role`);
    const oid=(await db.query<{id:number}>('select $1::regprocedure::oid id',[signature])).rows[0].id;
    const p=await payload([row('preserved-before-cutover')]),first=await intake(p);
    const snapshot=async()=>({imports:(await db.query('select * from finance_statement_imports order by id')).rows,entries:(await db.query('select * from finance_bank_entries order by id')).rows});
    const before=await snapshot();
    await db.exec(readFileSync('supabase/migrations/20260910123613_finance_retire_legacy_statement_import.sql','utf8'));
    expect(await snapshot()).toEqual(before);
    expect((await db.query<{id:number}>('select $1::regprocedure::oid id',[signature])).rows[0].id).toBe(oid);
    for(const role of ['anon','authenticated','service_role'])expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed).toBe(false);
    // Even an owner call must hit the retired body, not the old writer.
    await db.exec('savepoint retired_import');
    await expect(db.query("select import_bank_statement($1,$2,'old.csv','old','2026-01-01','2026-01-31','[]')",[i.tenant,i.account])).rejects.toThrow('finance_legacy_statement_import_retired');
    await db.exec('rollback to savepoint retired_import');
    expect(await intake(p)).toEqual(first);
    const next=await intake(await payload([row('new-after-cutover')]));
    expect(next.import_id).not.toBe(first.import_id);
    expect((await snapshot()).imports).toHaveLength(2);
  });
  it('rolls back the entire import if a later row is invalid',async()=>{
    await expect(intake(await payload([row('valid'),row('invalid',0)]))).rejects.toThrow('finance_invalid_statement_row');
    expect((await db.query('select * from finance_bank_entries')).rows).toHaveLength(0);
    expect((await db.query('select * from finance_statement_imports')).rows).toHaveLength(0);
  });
  it('denies drivers, cross-tenant accounts, missing originals and reimport with a new command ID',async()=>{
    const p=await payload([row()]);await expect(intake(p,i.driverUser)).rejects.toThrow('finance_access_denied');
    const absentHash='0'.repeat(64);
    await expect(intake({...p,file_hash:absentHash,source_path:`${i.tenant}/imports/${absentHash}.csv`})).rejects.toThrow('finance_statement_source_missing');
    await expect(intake({...p,bank_account_id:i.otherAccount})).rejects.toThrow('finance_invalid_account');
    await intake(p);await expect(intake({...p,request_id:randomUUID()})).rejects.toThrow('finance_statement_already_imported');
    expect((await financeAs(db,i.driverUser,'select * from finance_bank_entries')).rows).toHaveLength(0);
    expect((await financeAs(db,i.driverUser,"select * from storage.objects where bucket_id='finance-statements'")).rows).toHaveLength(0);
  });
});
