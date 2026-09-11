import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
import {closingChargeFixtureIds as f} from '../src/test/helpers/closingLifecycleDatabase.ts';
import {installFinanceFiscalIntegrationFixture} from '../src/test/helpers/financeFiscalIntegrationFixture.ts';

// Invoked after the native receivable fixture, never against an application DB.
export async function runRecordedMoneyNative({query,contested,literal:q}){
 const api=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const bank='cf600000-0000-4000-8000-000000000001';
 await query(`create table if not exists auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
  insert into auth.users values(${q(i.operator)},'finance-qa@example.test','{}') on conflict(id) do nothing;
  update tenant_memberships set active=true,role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);
 async function install(file){const sql=readFileSync('supabase/migrations/'+file,'utf8');await query('begin;'+sql+'commit;');console.log('Candidate '+file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 await install('20260909212104_finance_ledger_foundation.sql');
 await installFinanceFiscalIntegrationFixture({exec:sql=>query('begin;'+sql+'commit;')});
 for(const file of ['20260910024438_finance_receivable_movement_projection.sql','20260910025658_finance_receipt_allocation_corrections.sql','20260910030634_finance_explicit_receipt_refunds.sql'])await install(file);
 const day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 const title=async()=>{const id=randomUUID();await query(`insert into receivables(id,tenant_id,client_id,invoice_number,description,amount,status,received_amount,created_by)
  values(${q(id)},${q(i.tenant)},${q(f.client)},'QA-RACE','Recebível sintético concorrente',100,'pending',0,${q(i.operator)});`);return id;};
 const entry=async amount=>{const id=randomUUID();await query(`insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by)
  values(${q(id)},${q(i.tenant)},${q(bank)},'in','receipt',${amount},${q(day)},'Entrada QA concorrente','Pagador QA',${q(i.operator)});`);return id;};
 const context=async id=>JSON.parse(await query(`${api}select get_receivable_financial_context(${q(i.tenant)},${q(id)});`));
 const payment=async(id,movement,amount=700)=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:id,expected_revision:(await context(id)).revision,
  action:'receive',reason:'Baixa concorrente sintética',amount_cents:amount,effective_date:day,bank_account_id:bank,method:'pix',movement_id:movement});
 const call=p=>`${api}select apply_receivable_financial_command(${q(JSON.stringify(p))}::jsonb);`;
 const correction=p=>`${api}select correct_finance_receipt_allocation(${q(JSON.stringify(p))}::jsonb);`;
 const tests=[
  ['two titles cannot concurrently spend the same recorded entry beyond its capacity',async()=>{
   const first=await title(),second=await title(),movement=await entry(1000),winner=await payment(first,movement),loser=await payment(second,movement);
   const result=await contested(call(winner),call(loser),{driver:false,waiterSucceeds:false});assert.match(result.error,/finance_receipt_movement_capacity_exceeded/);
   assert.equal((await context(first)).received_cents,700);assert.equal((await context(second)).received_cents,0);
   assert.equal(await query(`select count(*) from finance_receivable_movement_links where movement_id=${q(movement)};`),'1');
   assert.equal(await query(`select amount_cents from finance_movements where id=${q(movement)};`),'1000');
  }],
  ['the same concurrent receipt request replays one allocation and one compatibility entry',async()=>{
   const id=await title(),movement=await entry(1000),p=await payment(id,movement);
   await contested(call(p),call(p),{driver:false});assert.equal((await context(id)).received_cents,700);
   assert.equal(await query(`select count(*) from finance_receivable_movement_links where movement_id=${q(movement)};`),'1');
  }],
  ['correction releases capacity atomically before another title can allocate it',async()=>{
   const first=await title(),second=await title(),movement=await entry(1000);
   const receipt=JSON.parse(await query(call(await payment(first,movement,1000))));
   const fix={version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:receipt.payment_id,expected_revision:(await context(first)).revision,reason:'Corrigir associação do título sintético'};
   const receive=await payment(second,movement,1000);
   await contested(correction(fix),call(receive),{driver:false});
   assert.equal((await context(first)).received_cents,0);assert.equal((await context(second)).received_cents,1000);
   assert.equal(await query(`select count(*) from finance_receipt_allocation_corrections where payment_id=${q(receipt.payment_id)};`),'1');
   assert.equal(await query(`select count(*) from finance_movements where id=${q(movement)};`),'1');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
