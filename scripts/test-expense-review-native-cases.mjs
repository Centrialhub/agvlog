import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installExpenseReviewFixture,expenseReviewSql} from '../src/test/helpers/expenseReviewDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runExpenseReviewNative({query,session,finish,waitForMarker,contested,literal:q}){
 const actor="set request.jwt.claim.sub="+q(i.operator)+";",api=actor+'set role authenticated;';
 const adapter={exec:query,query:async(sql,params=[])=>{const statement=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])).replace(/;\s*$/,'');return {rows:JSON.parse(await query("with qa_result as ("+statement+") select coalesce(json_agg(qa_result),'[]') from qa_result;"))};}};
 await installExpenseReviewFixture(adapter);
 await query("update tenant_memberships set role='admin',active=true where tenant_id="+q(i.tenant)+" and user_id="+q(i.operator)+";");
 const trip=await query('select id from dispatch_trips where tenant_id='+q(i.tenant)+' and driver_id='+q(i.driver)+' order by id limit 1;');assert.ok(trip);
 const seed=async(company=false,receipt=null)=>query(actor+"insert into driver_expenses(tenant_id,dispatch_trip_id,driver_id,category,amount,expense_at,payment_source,reimbursable,paid_with_advance,no_receipt,no_receipt_reason,receipt_url) values("+
  [q(i.tenant),q(trip),q(i.driver),"'food'",'25',"clock_timestamp()",q(company?'company_card':'driver'),company?'false':'true','false',receipt?'false':'true',receipt?'null':"'Comprovante indisponível em QA'",receipt?q(receipt):'null'].join(',')+") returning id;");
 const context=async expense=>JSON.parse(await query(api+'select get_driver_expense_review_context('+q(i.tenant)+','+q(expense)+');'));
 const payload=async(expense,action='approve')=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),expense_id:expense,action,reason:'Conferência de despesa QA',expected_revision:(await context(expense)).revision});
 const call=p=>api+'select review_driver_expense('+q(JSON.stringify(p))+'::jsonb);';
 const count=table=>query('select count(*) from '+table+';');
 const held=async(winner,loser)=>{const holder=session('expense-review-holder');holder.send('begin;'+winner+"select '__EXPENSE_HELD__';");await waitForMarker(holder,'__EXPENSE_HELD__');try{await assert.rejects(()=>query(loser),/40001.*expense_concurrent_change/);}finally{await finish(holder,'commit;');}};
 let approved;
 const tests=[
  ['expense migration preserves existing money and restricts review writers',async()=>{
   const before=await count('bank_transactions'),sql=expenseReviewSql();await query('begin;'+sql+'commit;');assert.equal(await count('bank_transactions'),before);console.log('Expense review candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   assert.equal(await query("select has_table_privilege('authenticated','driver_expenses','UPDATE');"),'f');for(const fn of ['_expense_review_snapshot(uuid,uuid)','_guard_expense_review_contract()','_check_expense_review_ack()'])assert.equal(await query("select has_function_privilege('authenticated',"+q(fn)+",'execute');"),'f');
  }],
  ['identical concurrent approvals create one audit and one company obligation',async()=>{
   approved=await seed(true);const p=await payload(approved),before=Number(await count('driver_expense_reviews'));await contested(call(p),call(p),{driver:false});assert.equal(Number(await count('driver_expense_reviews')),before+1);assert.equal((await context(approved)).status,'approved');assert.equal(await query("select count(*) from financial_obligations where source_table='driver_expenses' and source_id="+q(approved)+';'),'1');assert.equal(JSON.parse(await query(call(p))).expense_id,approved);
  }],
  ['approval and rejection with different keys cannot both decide the same expense',async()=>{
   const expense=await seed(),winner=await payload(expense),loser=await payload(expense,'reject');await held(call(winner),call(loser));assert.equal((await context(expense)).status,'approved');assert.equal(await query('select count(*) from driver_expense_reviews where expense_id='+q(expense)+';'),'1');
  }],
  ['a pending expense edited during review rejects the stale reviewer without partial writes',async()=>{
   const expense=await seed(),p=await payload(expense),before=await count('driver_expense_reviews');await held("update driver_expenses set amount=30 where id="+q(expense)+';',call(p));assert.equal(await count('driver_expense_reviews'),before);assert.equal((await context(expense)).status,'pending');await assert.rejects(()=>query(call(p)),/40001.*expense_context_changed/);
  }],
  ['membership revocation while waiting for a request key blocks the review',async()=>{
   const expense=await seed(),p=await payload(expense),lock="select pg_advisory_xact_lock(hashtext('driver-expense-review'),hashtext("+q(i.tenant+':'+i.operator+':'+p.request_id)+"))";
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(result.error,/42501.*expense_not_authorized/);}
   finally{await query('update tenant_memberships set active=true where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)+';');}assert.equal((await context(expense)).status,'pending');
  }],
  ['late audit failure rolls back expense and obligation and allows retry of the same key',async()=>{
   const expense=await seed(true),p=await payload(expense),before=await count('financial_obligations');await query("create function qa_fail_expense_review() returns trigger language plpgsql as $$begin raise exception 'QA expense audit failed';end;$$;create trigger qa_fail_expense_review before insert on driver_expense_reviews for each row execute function qa_fail_expense_review();");
   try{await assert.rejects(()=>query(call(p)),/QA expense audit failed/);}finally{await query('drop trigger qa_fail_expense_review on driver_expense_reviews;drop function qa_fail_expense_review();');}
   assert.equal(await count('financial_obligations'),before);assert.equal((await context(expense)).status,'pending');await query(call(p));assert.equal((await context(expense)).status,'approved');
  }],
  ['new expense flags a paid settlement and blocks additional payment without modifying prior balances',async()=>{
   const ownTrip=randomUUID(),settlement=randomUUID();await query(actor+"insert into dispatch_trips(id,tenant_id,driver_id,status) values("+q(ownTrip)+','+q(i.tenant)+','+q(i.driver)+",'planned');"+
    "insert into driver_settlements(id,tenant_id,dispatch_trip_id,driver_id,status,total_paid_amount,driver_payable_amount,needs_recalculation) values("+[q(settlement),q(i.tenant),q(ownTrip),q(i.driver),"'paid'",'25','25','false'].join(',')+");"+
    "insert into driver_expenses(tenant_id,dispatch_trip_id,driver_id,category,amount,no_receipt,no_receipt_reason) values("+q(i.tenant)+','+q(ownTrip)+','+q(i.driver)+",'food',5,true,'Sem comprovante QA');");
   assert.equal(await query('select needs_recalculation from driver_settlements where id='+q(settlement)+';'),'t');assert.equal(await query('select total_paid_amount=25 and driver_payable_amount=25 and status=\'paid\' from driver_settlements where id='+q(settlement)+';'),'t');
   const before=await count('driver_settlement_payments');await assert.rejects(()=>query(actor+'insert into driver_settlement_payments(settlement_id,tenant_id,amount) values('+q(settlement)+','+q(i.tenant)+',1);'),/23514.*settlement_requires_review_before_payment/);assert.equal(await count('driver_settlement_payments'),before);
  }],
  ['concurrent receipt removal cannot pass an approval with stale evidence',async()=>{
   const path=i.tenant+'/expenses/'+trip+'/'+randomUUID()+'.png';await query("insert into storage.objects(bucket_id,name) values('receipts',"+q(path)+');');const expense=await seed(false,path),p=await payload(expense);await held("delete from storage.objects where bucket_id='receipts' and name="+q(path)+';',call(p));assert.equal((await context(expense)).status,'pending');assert.equal((await context(expense)).can_approve,false);
  }],
  ['reviews on two expenses of one trip serialize without losing either decision',async()=>{
   const first=await seed(),second=await seed(),winner=await payload(first),loser=await payload(second,'reject');await held(call(winner),call(loser));assert.equal((await context(first)).status,'approved');assert.equal((await context(second)).status,'pending');await query(call(await payload(second,'reject')));assert.equal((await context(second)).status,'rejected');
  }],
  ['review and expense history cannot be altered and drivers cannot read review audit rows',async()=>{
   await assert.rejects(()=>query('update driver_expenses set amount=1 where id='+q(approved)+';'),/55000.*immutable/);await assert.rejects(()=>query('delete from driver_expense_reviews where expense_id='+q(approved)+';'),/55000.*append-only/);
   await assert.rejects(()=>query(api+"update driver_expenses set approval_status='rejected' where id="+q(approved)+';'),/42501.*permission denied/);
   assert.equal(await query("set request.jwt.claim.sub="+q(i.user)+";set role authenticated;select count(*) from driver_expense_reviews;"),'0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
