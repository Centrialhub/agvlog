// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,it,expect} from 'vitest';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {setupFinanceStatementIntakeDatabase} from './helpers/setupFinanceStatementIntakeDatabase';
import {statementIntakeResultSchema} from '@/lib/financial/statementImportContract';
import {reconciliationOptionsSchema} from '@/lib/financial/reconciliationContract';
import {reconciliationHistorySchema} from '@/lib/financial/reconciliationHistoryContract';
import {ofxFile,ofxTransaction} from './helpers/financeOfxFixture';
import {readOfxStatement} from '../../supabase/functions/_shared/finance-ofx-reader';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
let db:Awaited<ReturnType<typeof setupFinanceStatementIntakeDatabase>>;
beforeAll(async()=>{db=await setupFinanceStatementIntakeDatabase();for(const name of ['20260910182541_finance_movement_correction_foundation','20260910182830_finance_movement_correction_history','20260910183442_finance_reconciliation_active_movements'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function payload(rows:ReturnType<typeof readOfxStatement>['rows']){
  const hash=createHash('sha256').update(randomUUID()).digest('hex'),path=`${i.tenant}/imports/${hash}.csv`;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('finance-statements',$1,'{\"size\":500,\"mimetype\":\"text/csv\"}')",[path]);
  return {version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,file_hash:hash,source_path:path,file_name:'extrato.csv',
    currency:'BRL',parser_version:'mapped-csv-v1',mapping:{date:'Data',amount:'Valor'},period_start:'2026-01-01',period_end:'2026-01-31',reason:'Extrato recebido para conferência',rows};
}
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
async function movement(){
 const request=randomUUID();const r=await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-09-09',description:'Pagamento informado',beneficiary_name:'Motorista',bank_reference:'exact-reference',reason:'Registro para conciliar extrato'}]);
 return {id:r.rows[0].v.movement_id,request};
}
// Owner-only fixture injection: no public void command exists in this stage.
async function voidMovement(m:Awaited<ReturnType<typeof movement>>){
 const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_void_storage','{}','{}')",[i.tenant,request,i.operator]);
 await db.query("insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values($1,$2,$3,$4,'void',$5,'QA','Invalidação de representação para teste',md5('QA'),jsonb_build_object('movement_id',$2::uuid::text))",[i.tenant,m.id,m.request,request,i.operator]);
}
async function entry(){return (await db.query<{id:string}>('select id from finance_bank_entries')).rows[0].id;}
async function context(m:string,e:string){return (await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_reconciliation_context($1,$2,$3) v',[i.tenant,[m],[e]])).rows[0].v;}
async function options(importId:string){return reconciliationOptionsSchema.parse((await financeAs<{v:unknown}>(db,i.operator,"select list_finance_reconciliation_options($1,$2,'movements') v",[i.tenant,importId])).rows[0].v);}
async function history(importId:string){return reconciliationHistorySchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_reconciliation_history($1,$2) v',[i.tenant,importId])).rows[0].v);}
async function manual(m:string,e:string,revision:string){return financeAs<{v:{group_id:string}}>(db,i.operator,'select reconcile_finance_bank_group($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_ids:[m],bank_entry_ids:[e],expected_revision:revision,reason:'Conferência manual de teste',account_evidence:'Conta e favorecido conferidos no documento'}]);}
async function rejectOwner(sql:string,params:unknown[],issue:string){await db.exec('savepoint expected');try{await expect(db.query(sql,params)).rejects.toThrow(issue);}finally{await db.exec('rollback to savepoint expected;release savepoint expected');}}
it('hides an invalidated selection and rejects stale manual submission without deleting original money',async()=>{
 const m=await movement(),s=await verifiedNativeSource(),e=await entry(),c=await context(m.id,e);
 expect((await options(s.import_id)).rows.map(r=>r.id)).toContain(m.id);
 await voidMovement(m);expect((await options(s.import_id)).total).toBe(0);
 await expect(manual(m.id,e,c.revision)).rejects.toThrow('finance_reconciliation_selection_unavailable');
 await expect(context(m.id,e)).rejects.toThrow('finance_reconciliation_selection_unavailable');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_reconciliation_groups')).rows[0].n).toBe(0);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(1);
});
it('automatic processing skips a voided exact reference and matches the sole active replacement',async()=>{
 const old=await movement();await voidMovement(old);
 // Historical duplicate owner fixture: record_movement still forbids duplicate references until its own migration.
 const current=(await db.query<{id:string}>("insert into finance_movements select gen_random_uuid(),tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,beneficiary_document,driver_id,bank_reference,receipt_path,created_by,created_at from finance_movements where id=$1 returning id",[old.id])).rows[0];
 const s=await verifiedNativeSource();
 expect((await db.query<{n:number}>('select finance_private.run_automatic_reconciliation_queue() n')).rows[0].n).toBe(1);
 const h=await history(s.import_id);expect(h.rows[0].evidence_issue).toBeNull();
 expect((await db.query<{ids:string[]}>('select movement_ids ids from finance_reconciliation_groups')).rows[0].ids).toEqual([current.id]);
});
it('does not auto-match when the only candidate is voided',async()=>{
 const m=await movement();await voidMovement(m);await verifiedNativeSource();
 expect((await db.query<{n:number}>('select finance_private.run_automatic_reconciliation_queue() n')).rows[0].n).toBe(0);
});
it('retains snapshots and reversal capability, but flags an owner-injected inactive historical movement',async()=>{
 const m=await movement(),s=await verifiedNativeSource(),e=await entry(),c=await context(m.id,e);
 const group=(await manual(m.id,e,c.revision)).rows[0].v.group_id;
 const before=(await db.query<{s:unknown}>('select evidence_snapshot s from finance_reconciliation_groups')).rows[0].s;
 await voidMovement(m);expect((await history(s.import_id)).rows[0].evidence_issue).toBe('movement_inactive');
 await financeAs(db,i.operator,'select reverse_finance_bank_reconciliation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),group_id:group,reason:'Revisão manual de representação inválida'}]);
 expect((await history(s.import_id)).rows[0].reversal).not.toBeNull();
 expect((await db.query<{s:unknown}>('select evidence_snapshot s from finance_reconciliation_groups')).rows[0].s).toEqual(before);
 expect((await options(s.import_id)).total).toBe(0);
 await rejectOwner('insert into finance_reconciliation_groups select gen_random_uuid(),tenant_id,bank_account_id,direction,amount_cents,movement_ids,bank_entry_ids,method,actor_id,actor_name,reason,account_evidence,evidence_snapshot,created_at from finance_reconciliation_groups where id=$1',[group],'finance_reconciliation_movement_inactive');
});
it('preserves access denial for driver, mixed driver/admin and foreign tenant',async()=>{
 const s=await verifiedNativeSource();
 await expect(financeAs(db,i.driverUser,"select list_finance_reconciliation_options($1,$2,'movements')",[i.tenant,s.import_id])).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);
 await expect(financeAs(db,i.driverUser,"select list_finance_reconciliation_options($1,$2,'movements')",[i.tenant,s.import_id])).rejects.toThrow('finance_access_denied');
 await expect(financeAs(db,i.operator,"select list_finance_reconciliation_options($1,$2,'movements')",[i.otherTenant,s.import_id])).rejects.toThrow('finance_access_denied');
});
