import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installReceivableFinancialFixture,receivableFinancialSql} from '../src/test/helpers/receivableFinancialDatabase.ts';
import {closingChargeFixtureIds as f} from '../src/test/helpers/closingLifecycleDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runReceivableFinancialNative({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;const api=operator+'set role authenticated;';
 await installReceivableFinancialFixture({exec:query});
 const day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 let receivable,report,firstPayment,secondPayment;const bank='cf600000-0000-4000-8000-000000000001';
 const context=async()=>JSON.parse(await query(`${api}select get_receivable_financial_context(${q(i.tenant)},${q(receivable)});`));
 const payload=async()=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:receivable,expected_revision:(await context()).revision,
  action:'receive',reason:'Recebimento sintético QA',amount_cents:1000,effective_date:day,bank_account_id:bank,method:'pix'});
 const reverse=async payment=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:receivable,expected_revision:(await context()).revision,
  action:'reverse',reason:'Estorno sintético QA',effective_date:day,payment_id:payment});
 const call=p=>`${api}select apply_receivable_financial_command(${q(JSON.stringify(p))}::jsonb);`;
 const count=table=>query(`select count(*) from ${table};`);
 const held=async(sql,command)=>{const holder=session('financial-held-row');holder.send(`begin;${sql};select '__FINANCIAL_ROW_HELD__';`);await waitForMarker(holder,'__FINANCIAL_ROW_HELD__');try{await assert.rejects(()=>query(command),/40001.*concurrent_change/);}finally{await finish(holder,'rollback;');}};
 const tests=[
  ['financial migration preserves existing ledger and restricts legacy payment APIs',async()=>{
   const before=await count('bank_transactions'),sql=receivableFinancialSql();await query('begin;'+sql+'commit;');assert.equal(await count('bank_transactions'),before);
   console.log('Receivable financial candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   assert.equal(await query("select has_function_privilege('authenticated','register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text)','execute');"),'f');
   const filters={period_start:day,period_end:day,date_basis:'invoice_issue',client_id:f.client};const source=JSON.parse(await query(`${api}select get_closing_report_sources(${q(i.tenant)},${q(JSON.stringify(filters))}::jsonb);`));
   const draft={version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),mode:'system',reason:'Conferência QA financeira',
    header:{title:'QA recebimentos',client_id:f.client,payer_client_id:null,report_type:'custom',report_model:'detailed',period_start:day,period_end:day},system:{filters,options:{allocation:'per_nf',only_with_cte:false},revision:source.revision}};
   report=JSON.parse(await query(`${api}select create_closing_report_draft(${q(JSON.stringify(draft))}::jsonb);`)).report.id;
   const closing={version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),report_id:report,action:'close',expected_revision:0,reason:'Conferência QA financeira'};
   await query(`${api}select apply_closing_report_action(${q(JSON.stringify(closing))}::jsonb);select generate_client_invoice_from_closing(${q(report)});`);
   receivable=await query(`select receivable_id from closing_reports where id=${q(report)};`);
   await query(`insert into bank_accounts(id,tenant_id,name) values(${q(bank)},${q(i.tenant)},'Banco QA local');update tenant_memberships set role='admin' where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);
   assert.equal((await context()).amount_cents,10000);
  }],
  ['concurrent identical financial requests commit one receipt and one acknowledgement',async()=>{
   const p=await payload();await contested(call(p),call(p),{driver:false});assert.equal(await count('receivables_payments'),'1');assert.equal(await count('bank_transactions'),'1');assert.equal((await context()).received_cents,1000);
   firstPayment=await query('select id from receivables_payments limit 1;');assert.equal(await count('receivable_financial_commands'),'1');
  }],
  ['different receipt commands fail fast on the same locked graph without overcounting',async()=>{
   const winner=await payload(),loser=await payload(),holder=session('financial-receipt-holder');holder.send('begin;'+call(winner)+"select '__FINANCIAL_RECEIPT_HELD__';");await waitForMarker(holder,'__FINANCIAL_RECEIPT_HELD__');
   try{await assert.rejects(()=>query(call(loser)),/40001.*concurrent_change/);}finally{await finish(holder,'commit;');}
   assert.equal((await context()).received_cents,2000);assert.equal(await count('receivables_payments'),'2');secondPayment=await query(`select id from receivables_payments where id<>${q(firstPayment)} limit 1;`);
  }],
  ['concurrent identical reversals keep original evidence and create only one debit',async()=>{
   const p=await reverse(firstPayment);await contested(call(p),call(p),{driver:false});assert.equal(await count('receivables_payments'),'2');assert.equal(await count('receivable_payment_reversals'),'1');assert.equal(await count('bank_transactions'),'3');assert.equal((await context()).received_cents,1000);
  }],
  ['distinct reversal keys cannot reverse the same receipt twice',async()=>{
   const winner=await reverse(secondPayment),loser=await reverse(secondPayment),holder=session('financial-reversal-holder');holder.send('begin;'+call(winner)+"select '__FINANCIAL_REVERSAL_HELD__';");await waitForMarker(holder,'__FINANCIAL_REVERSAL_HELD__');
   try{await assert.rejects(()=>query(call(loser)),/40001.*concurrent_change/);}finally{await finish(holder,'commit;');}
   const repeated=await reverse(secondPayment);await assert.rejects(()=>query(call(repeated)),/55000.*financial_action_requires_reconciliation_or_valid_state/);assert.equal(await count('receivable_payment_reversals'),'2');assert.equal((await context()).received_cents,0);
  }],
  ['membership revocation while waiting for a financial request key prevents posting',async()=>{
   const p=await payload();const lock=`select pg_advisory_xact_lock(hashtext('receivable-financial-command'),hashtext(${q(i.tenant+':'+i.operator+':'+p.request_id)}))`;
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(result.error,/42501.*not_authorized/);}
   finally{await query(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}assert.equal((await context()).received_cents,0);
  }],
  ['locked bank account and locked invoice reject posting without partial financial writes',async()=>{
   const before=await count('bank_transactions');await held(`update bank_accounts set name='temporário QA' where id=${q(bank)}`,call(await payload()));
   const invoice=(await context()).invoice_id;await held(`update client_invoices set updated_at=clock_timestamp() where id=${q(invoice)}`,call(await payload()));assert.equal(await count('bank_transactions'),before);
  }],
  ['failure after ledger posting rolls back receipt, debit and every financial projection',async()=>{
   const p=await payload(),before=await count('bank_transactions');await query("create function qa_fail_receipt_ack() returns trigger language plpgsql as $$begin raise exception 'QA receipt acknowledgement failed';end;$$;create trigger qa_fail_receipt_ack before insert on receivable_financial_commands for each row execute function qa_fail_receipt_ack();");
   try{await assert.rejects(()=>query(call(p)),/QA receipt acknowledgement failed/);}finally{await query('drop trigger qa_fail_receipt_ack on receivable_financial_commands;drop function qa_fail_receipt_ack();');}
   assert.equal(await count('bank_transactions'),before);assert.equal((await context()).received_cents,0);
  }],
  ['historical payments and bank economics are immutable while reconciliation metadata remains editable',async()=>{
   await assert.rejects(()=>query(`delete from receivables_payments where id=${q(firstPayment)};`),/immutable/);
   await assert.rejects(()=>query('update bank_transactions set amount=1;'),/immutable/);await query("update bank_transactions set reconciliation_status='matched';");
   assert.equal(await query("select sum(case when transaction_type='credit' then amount else -amount end) from bank_transactions;"),'0.00');
  }],
  ['changed freight sources do not prevent recording or reversing proven money on the original contract',async()=>{
   await query(`update fiscal_documents set freight_value=999 where id=${q(f.doc)};`);const receipt=JSON.parse(await query(call(await payload())));await query(call(await reverse(receipt.payment_id)));
   assert.equal((await context()).received_cents,0);assert.equal((await context()).amount_cents,10000);assert.equal(await count('receivables_payments'),'3');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
