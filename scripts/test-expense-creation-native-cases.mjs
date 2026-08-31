import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installExpenseCreationFixture,expenseCreationSql} from '../src/test/helpers/expenseCreationDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
import {expenseCreationReleaseSql} from '../src/test/helpers/expenseCreationRelease.ts';
export async function runExpenseCreationNative({query,session,finish,waitForMarker,contested,literal:q}){
 const adapter={exec:query,query:async(sql,params=[])=>{const statement=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])).replace(/;\s*$/,'');return {rows:JSON.parse(await query("with qa_result as ("+statement+") select coalesce(json_agg(qa_result),'[]') from qa_result;"))};}};
 await installExpenseCreationFixture(adapter);
 const api=actor=>"set request.jwt.claim.sub="+q(actor)+";set role authenticated;";
 const trip=randomUUID();await query("insert into dispatch_trips(id,tenant_id,driver_id,status,created_at) values("+q(trip)+','+q(i.tenant)+','+q(i.driver)+",'planned',now());");
 const context=async(source=trip,type='trip',actor=i.user)=>JSON.parse(await query(api(actor)+'select get_expense_creation_context('+q(i.tenant)+','+q(type)+','+q(source)+');'));
 const payload=async(source=trip,type='trip',actor=i.user)=>({version:1,tenant_id:i.tenant,actor_id:actor,request_id:randomUUID(),source_type:type,source_id:source,
  expected_revision:(await context(source,type,actor)).revision,receipt:null,fields:{category:'food',amount_cents:2500,expense_at:new Date().toISOString(),payment_source:'driver',reimbursable:true,no_receipt:true,no_receipt_reason:'Comprovante indisponível em QA',cost_center:type==='settlement'?'operation':null}});
 const call=p=>api(p.actor_id)+'select create_driver_expense_command('+q(JSON.stringify(p))+'::jsonb);';
 const count=table=>query('select count(*) from '+table+';');
 const held=async(winner,loser)=>{const h=session('expense-creation-holder');h.send('begin;'+winner+"select '__EXPENSE_CREATION_HELD__';");await waitForMarker(h,'__EXPENSE_CREATION_HELD__');try{await assert.rejects(()=>query(loser),/40001.*expense_creation_concurrent_change/);}finally{await finish(h,'commit;');}};
 const tests=[
  ['creation migration preserves existing financial rows and restricts helpers and legacy writers',async()=>{
   const before=await count('bank_transactions'),sql=expenseCreationSql();await query('begin;'+sql+'commit;');assert.equal(await count('bank_transactions'),before);console.log('Expense creation candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   for(const fn of ['_expense_creation_source(uuid,uuid,text,uuid)','_build_manual_driver_settlement(uuid)','inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)'])
    assert.equal(await query("select has_function_privilege('authenticated',"+q(fn)+",'execute');"),'f');
  }],
  ['identical concurrent driver expense commands commit one expense and one audit',async()=>{
   const p=await payload(),before=Number(await count('driver_expenses'));await contested(call(p),call(p),{driver:false});assert.equal(Number(await count('driver_expenses')),before+1);assert.equal(await query('select count(*) from driver_expense_creations where request_id='+q(p.request_id)+';'),'1');
   const first=JSON.parse(await query(call(p))),second=JSON.parse(await query(call(p)));assert.deepEqual(first,second);
  }],
  ['different simultaneous commands on one trip conflict cleanly and can be retried',async()=>{
   const first=await payload(),second=await payload(),before=Number(await count('driver_expenses'));await held(call(first),call(second));assert.equal(Number(await count('driver_expenses')),before+1);
   await query(call(second));assert.equal(Number(await count('driver_expenses')),before+2);
  }],
  ['driver revocation while a command waits for its key denies the write',async()=>{
   const p=await payload(),lock="select pg_advisory_xact_lock(hashtext('driver-expense-creation'),hashtext("+q(i.tenant+':'+i.user+':'+p.request_id)+"))",before=await count('driver_expenses');
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)});assert.match(result.error,/42501.*expense_creation_not_authorized/);}
   finally{await query('update tenant_memberships set active=true where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)+';');}assert.equal(await count('driver_expenses'),before);
  }],
  ['trip context changes cannot race an expense through a stale preview',async()=>{
   const p=await payload();await held('update dispatch_trips set notes='+q('Replanned concurrently')+' where id='+q(trip)+';',call(p));await assert.rejects(()=>query(call(p)),/40001.*expense_creation_context_changed/);
  }],
  ['late audit failure rolls back the expense and the same request can be retried',async()=>{
   const p=await payload(),before=await count('driver_expenses');await query("create function qa_fail_expense_creation() returns trigger language plpgsql as $$begin raise exception 'QA expense creation audit failed';end;$$;create trigger qa_fail_expense_creation before insert on driver_expense_creations for each row execute function qa_fail_expense_creation();");
   try{await assert.rejects(()=>query(call(p)),/QA expense creation audit failed/);}finally{await query('drop trigger qa_fail_expense_creation on driver_expense_creations;drop function qa_fail_expense_creation();');}
   assert.equal(await count('driver_expenses'),before);await query(call(p));assert.equal(Number(await count('driver_expenses')),Number(before)+1);
  }],
  ['manual creation and recalculation serialize and approval survives repeated recalculation',async()=>{
   const s=await query("insert into driver_settlements(tenant_id,driver_id,is_manual,status) values("+q(i.tenant)+','+q(i.driver)+",true,'pending_review') returning id;"),p=await payload(s,'settlement',i.operator);
   const recalc=api(i.operator)+'select recalculate_manual_expense_settlement('+q(i.tenant)+','+q(s)+');';await held(recalc,call(p));
   const created=JSON.parse(await query(call(await payload(s,'settlement',i.operator)))),review=JSON.parse(await query(api(i.operator)+'select get_driver_expense_review_context('+q(i.tenant)+','+q(created.expense_id)+');'));
   await query(api(i.operator)+'select review_driver_expense('+q(JSON.stringify({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),expense_id:created.expense_id,action:'approve',reason:'Despesa manual conferida em QA',expected_revision:review.revision}))+'::jsonb);');
   const before=await count('driver_settlement_payments');await query(recalc);await query(recalc);assert.equal(await query('select driver_payable_amount=25 and approved_expenses_total=25 and not needs_recalculation from driver_settlements where id='+q(s)+';'),'t');assert.equal(await query("select count(*) from driver_settlement_items where settlement_id="+q(s)+" and item_type='expense';"),'1');assert.equal(await count('driver_settlement_payments'),before);
  }],
  ['receipt metadata concurrent change cannot create an expense with unverified evidence',async()=>{
   const p=await payload();p.receipt={sha256:'a'.repeat(64),mime:'image/png',size:8};p.fields.no_receipt=false;p.fields.no_receipt_reason=null;
   const args=[i.tenant,i.user,p.request_id,'trip',trip].map(q).join(',')+','+q(JSON.stringify(p.receipt))+'::jsonb',probe=JSON.parse(await query('select inspect_expense_receipt_upload('+args+');'));
   await query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',"+q(probe.path)+','+q(JSON.stringify(probe.metadata))+'::jsonb);');
   // Local fixture metadata only: hosted object mutations require Storage API.
   await held("update storage.objects set user_metadata='{}' where name="+q(probe.path)+';',call(p));
   await assert.rejects(()=>query(call(p)),/23514.*expense_receipt_existing_object_mismatch/);
  }],
  ['legacy manual expense links are preserved until deliberate reconciliation',async()=>{
   const created=JSON.parse(await query(call(await payload()))),s=await query("insert into driver_settlements(tenant_id,driver_id,is_manual,status) values("+q(i.tenant)+','+q(i.driver)+",true,'pending_review') returning id;");
   await query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount) values("+q(i.tenant)+','+q(s)+",'expense','driver_expenses',"+q(created.expense_id)+",'Vínculo legado a conferir',25);");
   await assert.rejects(()=>query(api(i.operator)+'select recalculate_manual_expense_settlement('+q(i.tenant)+','+q(s)+');'),/23514.*manual_expense_link_reconciliation_required/);
   assert.equal(await query("select count(*) from driver_settlement_items where settlement_id="+q(s)+" and item_type='expense' and amount=25;"),'1');
  }],
  ['containment refuses an active creation transaction and resumes its exact committed result',async()=>{
   const p=await payload(),h=session('expense-release-active');h.send('begin;'+call(p)+"select '__EXPENSE_ACTIVE__';");await waitForMarker(h,'__EXPENSE_ACTIVE__');
   try{await assert.rejects(()=>query(expenseCreationReleaseSql('contain')),/expense_creation_release_active_requests/);}
   finally{await finish(h,'commit;');}
   const result=JSON.parse(await query(call(p))),before=await count('driver_expenses'),payments=await count('bank_transactions');
   await query(expenseCreationReleaseSql('contain'));await assert.rejects(()=>query(call(p)),/permission denied/);
   await assert.rejects(()=>query(api(i.user)+'select get_expense_creation_context('+q(i.tenant)+",'trip',"+q(trip)+');'),/expense_creation_suspended/);
   await query(expenseCreationReleaseSql('resume'));assert.deepEqual(JSON.parse(await query(call(p))),result);assert.equal(await count('driver_expenses'),before);assert.equal(await count('bank_transactions'),payments);
  }],
  ['a creation racing uncommitted containment fails before acquiring any business locks',async()=>{
   const p=await payload(),h=session('expense-release-holder');h.send('begin;'+expenseCreationReleaseSql('contain',false)+"select '__EXPENSE_RELEASE_HELD__';");await waitForMarker(h,'__EXPENSE_RELEASE_HELD__');
   try{await assert.rejects(()=>query(call(p)),/40001.*expense_creation_release_busy/);}
   finally{await finish(h,'commit;');}
   await query(expenseCreationReleaseSql('resume'));await query(call(p));
   assert.equal(await query('select count(*) from driver_expense_creations where request_id='+q(p.request_id)+';'),'1');
  }],
  ['owner execution after containment cannot bypass the checked release gate',async()=>{
   const p=await payload(),before=await count('driver_expenses');await query(expenseCreationReleaseSql('contain'));
   await assert.rejects(()=>query('set request.jwt.claim.sub='+q(i.user)+';select create_driver_expense_command('+q(JSON.stringify(p))+'::jsonb);'),/expense_creation_suspended/);
   assert.equal(await count('driver_expenses'),before);await query(expenseCreationReleaseSql('resume'));
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
