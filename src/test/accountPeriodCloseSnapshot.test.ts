// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createAccountPeriodCloseDatabase,seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {accountPeriodClosePreviewSchema} from '@/lib/financial/accountPeriodCloseContract';
let db:Awaited<ReturnType<typeof createAccountPeriodCloseDatabase>>;
beforeAll(async()=>{db=await createAccountPeriodCloseDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function preview(from='2026-08-01',to='2026-08-31'){return accountPeriodClosePreviewSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select preview_finance_account_period_close($1,$2,$3,$4) result',[i.tenant,i.account,from,to])).rows[0].result);}
it('does not declare an empty account closed without opening, coverage, legacy review and guards',async()=>{
 const a=await preview(),b=await preview();expect(a.revision).toBe(b.revision);expect(a.eligible).toBe(false);expect(a.can_execute).toBe(false);
 expect(a.blockers.map(x=>x.code)).toEqual(expect.arrayContaining(['opening_requires_review','coverage_requires_review','legacy_classifier_missing','period_guards_incomplete']));
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);expect((await preview()).can_execute).toBe(true);
});
it('captures actual approved bank evidence and opening without bypassing unfinished gates',async()=>{
 await seedAccountCloseStatement(db,'2026-07-31',10000);await seedAccountCloseStatement(db,'2026-08-31',10000);
 const evidence=(await financeAs<{result:{revision:string}}>(db,i.operator,'select get_finance_statement_period_evidence($1,$2,$3,$4) result',[i.tenant,i.account,'2026-08-01','2026-08-31'])).rows[0].result;
 await financeAs(db,i.operator,'select record_finance_account_opening($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-08-01',to:'2026-08-31',revision:evidence.revision,reason:'Abertura conferida no extrato bancário original'})]);
 const coverage=(await financeAs<{result:{revision:string}}>(db,i.operator,'select get_finance_statement_coverage_review($1,$2,$3,$4) result',[i.tenant,i.account,'2026-08-01','2026-08-31'])).rows[0].result;
 await financeAs(db,i.operator,'select record_finance_statement_coverage_approval($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-08-01',to:'2026-08-31',revision:coverage.revision,reason:'Conferidos todos os originais do período',originals_obtained_from_bank:true,complete_period_confirmed:true})]);
 const result=await preview();expect(result.balances).toMatchObject({opening_cents:'10000',closing_cents:'10000',bank_in_cents:'0',recorded_out_cents:'0'});expect(result.opening_id).toBeTruthy();
 expect(result.blockers.map(x=>x.code)).not.toContain('coverage_requires_review');expect(result.eligible).toBe(false);expect(result.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({source_kind:'finance_account_openings'}),expect.objectContaining({source_kind:'finance_statement_verifications'})]));
});
it('changes revision for offsetting money and denies drivers and invalid periods',async()=>{
 const before=await preview();for(const direction of ['in','out'])await financeAs(db,i.operator,'select record_finance_movement($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction,nature:'other',amount_cents:1000,occurred_on:'2026-08-10',description:'Movimento compensado QA',beneficiary_name:'Contraparte QA',reason:'Registro para conferir movimentos compensados'})]);
 const after=await preview();expect(after.revision).not.toBe(before.revision);expect(after.blockers.map(x=>x.code)).toContain('bank_ledger_difference');
 await expect(preview('2026-08-31','2026-08-01')).rejects.toThrow('finance_invalid_period');await expect(financeAs(db,i.driverUser,'select preview_finance_account_period_close($1,$2,$3,$4)',[i.tenant,i.account,'2026-08-01','2026-08-31'])).rejects.toThrow('finance_access_denied');
});
it('fails closed when the classifier claims approval while returning unresolved or malformed blockers',async()=>{
 // Deliberately inconsistent dependency contract, never a positive close fixture.
 for(const blockers of ['["unresolved_source"]','null']){
  await db.exec(`create or replace function finance_private.legacy_cut_review_status(uuid,uuid,date,date) returns jsonb language sql as $$select '{"current":true,"approved":true,"blockers":${blockers}}'::jsonb$$`);
  expect((await preview()).blockers.map(x=>x.code)).toContain('legacy_cut_requires_review');
 }
});
