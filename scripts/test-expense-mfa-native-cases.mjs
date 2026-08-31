import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installExpenseMfaFixture,expenseMfaSql} from '../src/test/helpers/expenseMfaDatabase.ts';
import {expenseMfaReleaseSql} from '../src/test/helpers/expenseMfaRelease.ts';
import {operationIds as existing} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runExpenseMfaNative({query,session,finish,waitForMarker,contested,literal:q}){
 const adapter={exec:query};
 const i={tenant:existing.tenant,driver:randomUUID(),user:randomUUID(),operator:randomUUID(),settlement:randomUUID()};
 const watched=['loads','dispatch_trips','dispatch_stops','driver_expenses','driver_expense_creations','driver_settlements','driver_settlement_items','driver_settlement_payments','bank_transactions','financial_obligations'];
 const exclusions={driver_expenses:'driver_id<>',driver_expense_creations:'driver_id<>',driver_settlements:'driver_id<>',driver_settlement_items:'settlement_id<>'};
 const snapshot=async()=>Object.fromEntries(await Promise.all(watched.map(async table=>{
  const scope=exclusions[table]?' where '+exclusions[table]+q(table==='driver_settlement_items'?i.settlement:i.driver):
   table==='financial_obligations'?' where not(source_table=\'driver_expenses\' and source_id in(select id from driver_expenses where driver_id='+q(i.driver)+'))':'';
  return [table,await query("select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'[]')) from public."+table+' r'+scope+';')];
 })));const initial=await snapshot();
 await installExpenseMfaFixture(adapter);await query('begin;'+expenseMfaSql()+'commit;');
 console.log('Expense MFA candidate SHA256: '+createHash('sha256').update(expenseMfaSql()).digest('hex'));assert.deepEqual(await snapshot(),initial);
 await query('insert into drivers(id,tenant_id,user_id,name,active) values('+[i.driver,i.tenant,i.user,'Motorista MFA nativo'].map(q).join(',')+',true);'+
  'insert into tenant_memberships(tenant_id,user_id,role,active) values('+[i.tenant,i.operator,'operator'].map(q).join(',')+',true),('+[i.tenant,i.user,'driver'].map(q).join(',')+',true);'+
  'insert into driver_settlements(id,tenant_id,driver_id,is_manual,status) values('+[i.settlement,i.tenant,i.driver].map(q).join(',')+",true,'pending_review');");
 const api=(aal='aal1')=>'set request.jwt.claim.sub='+q(i.operator)+';set request.jwt.claims='+q(JSON.stringify({aal}))+';set role authenticated;';
 const context=async(aal='aal1')=>JSON.parse(await query(api(aal)+'select get_expense_creation_context('+[i.tenant,'settlement',i.settlement].map(q).join(',')+');'));
 const payload=async(aal='aal1')=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),source_type:'settlement',source_id:i.settlement,
  expected_revision:(await context(aal)).revision,receipt:null,fields:{category:'food',amount_cents:2500,expense_at:'2026-08-30T12:00:00Z',payment_source:'driver',reimbursable:true,no_receipt:true,no_receipt_reason:'Sem comprovante QA',cost_center:'operation'}});
 const call=(p,aal='aal1',schema='public')=>api(aal)+'select '+schema+'.create_driver_expense_command('+q(JSON.stringify(p))+'::jsonb);';
 const setRole=role=>query('update tenant_memberships set role='+q(role)+' where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)+';');
 const counts=()=>query('select count(*) from driver_expenses where manual_settlement_id='+q(i.settlement)+';');
 const tests=[
  ['expense MFA migration preserves prior evidence and exposes seven invoker wrappers',async()=>{
   assert.equal(await query("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in('get_expense_creation_context','get_expense_receipt_status','inspect_expense_receipt_upload','create_driver_expense_command','list_driver_expenses','list_driver_expense_sources','recalculate_manual_expense_settlement') and not prosecdef;"),'7');
   const p=await payload();await setRole('admin');try{await assert.rejects(()=>query(call(p)),/42501.*expense_creation_mfa_required/);}finally{await setRole('operator');}
  }],
  ['expense MFA concurrent identical commands still create a single expense',async()=>{
   const p=await payload(),before=Number(await counts());await contested(call(p),call(p),{driver:false});assert.equal(Number(await counts()),before+1);
  }],
  ['expense MFA rechecks a promotion while an AAL1 request waits for its idempotency key',async()=>{
   const p=await payload(),before=await counts(),lock="select pg_advisory_xact_lock(hashtext('driver-expense-creation'),hashtext("+q(i.tenant+':'+i.operator+':'+p.request_id)+'))';
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:"update tenant_memberships set role='admin' where tenant_id="+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(result.error,/42501.*expense_creation_mfa_required/);}
   finally{await setRole('operator');}assert.equal(await counts(),before);
  }],
  ['expense MFA rechecks promotion before returning a previously confirmed replay',async()=>{
   const p=await payload(),ack=JSON.parse(await query(call(p))),before=await counts(),lock="select pg_advisory_xact_lock(hashtext('driver-expense-creation'),hashtext("+q(i.tenant+':'+i.operator+':'+p.request_id)+'))';
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:"update tenant_memberships set role='admin' where tenant_id="+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(result.error,/42501.*expense_creation_mfa_required/);assert.deepEqual(JSON.parse(await query(call(p,'aal2'))),ack);}
   finally{await setRole('operator');}assert.equal(await counts(),before);
  }],
  ['expense MFA role update held concurrently rejects recalc before any totals change',async()=>{
   const before=await query('select to_jsonb(s) from driver_settlements s where id='+q(i.settlement)+';'),holder=session('expense-mfa-membership');
   holder.send("begin;update tenant_memberships set role='admin' where tenant_id="+q(i.tenant)+' and user_id='+q(i.operator)+";select '__MFA_ROLE_HELD__';");await waitForMarker(holder,'__MFA_ROLE_HELD__');
   try{await assert.rejects(()=>query(api()+'select recalculate_manual_expense_settlement('+q(i.tenant)+','+q(i.settlement)+');'),/40001.*expense_creation_concurrent_change/);}
   finally{await finish(holder,'commit;');await setRole('operator');}
   assert.equal(await query('select to_jsonb(s) from driver_settlements s where id='+q(i.settlement)+';'),before);
  }],
  ['expense MFA containment cannot race an active transaction and never reopens service inspection',async()=>{
   const holder=session('expense-mfa-release');
   holder.send("begin;select pg_advisory_xact_lock_shared(hashtext('driver-expense-release'),1);select '__MFA_RELEASE_HELD__';");await waitForMarker(holder,'__MFA_RELEASE_HELD__');
   try{await assert.rejects(()=>query(expenseMfaReleaseSql('contain')),/expense_creation_release_active_requests/);}finally{await finish(holder,'commit;');}
   const p=await payload();await query(expenseMfaReleaseSql('contain'));
   await assert.rejects(()=>query(call(p)),/42501/);await assert.rejects(()=>query(call(p,'aal1','expense_creation_private')),/42501/);
   await query(expenseMfaReleaseSql('resume'));assert.equal(await query("select has_function_privilege('service_role','public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','execute');"),'f');
  }],
  ['expense MFA late failure rolls back expense and audit together',async()=>{
   const p=await payload(),before=await counts();await query("create function qa_expense_mfa_fail() returns trigger language plpgsql as $$begin raise exception 'QA expense MFA failure';end;$$;create trigger z_qa_expense_mfa_fail after insert on driver_expense_creations for each row execute function qa_expense_mfa_fail();");
   try{await assert.rejects(()=>query(call(p)),/QA expense MFA failure/);}finally{await query('drop trigger z_qa_expense_mfa_fail on driver_expense_creations;drop function qa_expense_mfa_fail();');}
   assert.equal(await counts(),before);await query(call(p));assert.equal(Number(await counts()),Number(before)+1);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}
 assert.deepEqual(await snapshot(),initial);return tests.length;
}
