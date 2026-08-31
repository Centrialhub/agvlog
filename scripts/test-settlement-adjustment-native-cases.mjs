import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installSettlementAdjustmentFixture,settlementAdjustmentSql} from '../src/test/helpers/settlementAdjustmentDatabase.ts';
import {settlementAdjustmentReleaseSql} from '../src/test/helpers/settlementAdjustmentRelease.ts';
import {operationIds as existing} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runSettlementAdjustmentNative({query,session,finish,waitForMarker,contested,literal:q}){
 const i={tenant:existing.tenant,driver:randomUUID(),user:randomUUID(),operator:randomUUID(),settlement:randomUUID()};
 const watched=['loads','dispatch_trips','dispatch_stops','fiscal_documents','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_payments','bank_transactions','financial_obligations'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(watched.map(async table=>{
  const scope=table==='driver_settlements'?' where id<>'+q(i.settlement):['driver_settlement_items','driver_settlement_events','driver_settlement_payments'].includes(table)?' where settlement_id<>'+q(i.settlement):'';
  return [table,await query("select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'[]')) from public."+table+' r'+scope+';')];
 })));const initial=await snapshot();
 await installSettlementAdjustmentFixture({exec:query});await query('begin;'+settlementAdjustmentSql()+'commit;');
 console.log('Settlement adjustment candidate SHA256: '+createHash('sha256').update(settlementAdjustmentSql()).digest('hex'));assert.deepEqual(await snapshot(),initial);
 await query('insert into drivers(id,tenant_id,user_id,name,active) values('+[i.driver,i.tenant,i.user,'Motorista ajustes nativo'].map(q).join(',')+',true);'+
  'insert into tenant_memberships(tenant_id,user_id,role,active) values('+[i.tenant,i.operator,'operator'].map(q).join(',')+',true);'+
  'insert into driver_settlements(id,tenant_id,driver_id,is_manual,status) values('+[i.settlement,i.tenant,i.driver].map(q).join(',')+",true,'pending_review');");
 const api=(aal='aal1')=>'set request.jwt.claim.sub='+q(i.operator)+';set request.jwt.claims='+q(JSON.stringify({aal}))+';set role authenticated;';
 const context=async()=>JSON.parse(await query(api()+'select get_driver_settlement_adjustment_context('+[i.tenant,i.settlement].map(q).join(',')+');'));
 const payload=async()=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),settlement_id:i.settlement,action:'add',item_id:null,nature:'credit',amount_cents:1000,description:'Diária QA',reason:'Conferência QA nativa',expected_revision:(await context()).revision});
 const call=(p,aal='aal1')=>api(aal)+'select apply_driver_settlement_adjustment('+q(JSON.stringify(p))+'::jsonb);';
 const counts=()=>query('select count(*) from driver_settlement_adjustments where settlement_id='+q(i.settlement)+';');
 const role=()=>query("update tenant_memberships set role='operator',active=true where tenant_id="+q(i.tenant)+' and user_id='+q(i.operator)+';');
 const lock=p=>"select pg_advisory_xact_lock(hashtext('driver-settlement-adjustment'),hashtext("+q(i.tenant+':'+i.operator+':'+p.request_id)+'))';
 const tests=[
  ['adjustments coalesce overlapping identical commands and audit once',async()=>{const p=await payload(),before=Number(await counts());await contested(call(p),call(p),{driver:false});assert.equal(Number(await counts()),before+1);}],
  ['adjustments reject another pending command and require its refreshed revision after commit',async()=>{
   const p=await payload(),other={...p,request_id:randomUUID()},holder=session('adjustment-overlap');holder.send('begin;'+call(p)+"select '__ADJUSTMENT_HELD__';");await waitForMarker(holder,'__ADJUSTMENT_HELD__');
   try{await assert.rejects(()=>query(call(other)),/55P03/);}finally{await finish(holder,'commit;');}
   await assert.rejects(()=>query(call(other)),/40001.*settlement_adjustment_context_changed/);
  }],
  ['adjustments recheck membership revocation after idempotency wait',async()=>{
   const p=await payload(),before=await counts();try{const result=await contested(lock(p),call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(result.error,/42501.*settlement_adjustment_not_authorized/);}finally{await role();}assert.equal(await counts(),before);
  }],
  ['adjustments recheck privileged MFA before replay after idempotency wait',async()=>{
   const p=await payload(),ack=JSON.parse(await query(call(p))),before=await counts();try{const result=await contested(lock(p),call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:"update tenant_memberships set role='admin' where tenant_id="+q(i.tenant)+' and user_id='+q(i.operator)});assert.match(result.error,/42501.*settlement_adjustment_mfa_required/);assert.deepEqual(JSON.parse(await query(call(p,'aal2'))),ack);}finally{await role();}assert.equal(await counts(),before);
  }],
  ['adjustments reject concurrent settlement closure before any item is inserted',async()=>{
   const p=await payload(),before=await counts(),holder=session('adjustment-close');holder.send('begin;set request.jwt.claim.sub='+q(i.operator)+';set request.jwt.claims='+q(JSON.stringify({aal:'aal1'}))+";update driver_settlements set status='approved' where id="+q(i.settlement)+";select '__ADJUSTMENT_CLOSE__';");await waitForMarker(holder,'__ADJUSTMENT_CLOSE__');
   try{await assert.rejects(()=>query(call(p)),/55P03/);}finally{await finish(holder,'rollback;');}assert.equal(await counts(),before);
  }],
  ['adjustment containment cannot race active requests and resumes exact replay only',async()=>{
   const p=await payload(),ack=JSON.parse(await query(call(p))),holder=session('adjustment-release');holder.send("begin;select pg_advisory_xact_lock_shared(hashtext('settlement-adjustment-release'),1);select '__ADJUSTMENT_RELEASE__';");await waitForMarker(holder,'__ADJUSTMENT_RELEASE__');
   try{await assert.rejects(()=>query(settlementAdjustmentReleaseSql('contain')),/settlement_adjustment_release_active_requests/);}finally{await finish(holder,'commit;');}
   await query(settlementAdjustmentReleaseSql('contain'));await assert.rejects(()=>query(call(p)),/42501/);await query(settlementAdjustmentReleaseSql('resume'));assert.deepEqual(JSON.parse(await query(call(p))),ack);
   assert.equal(await query("select has_function_privilege('authenticated','public.add_driver_settlement_adjustment(uuid,text,numeric,text,text)','execute');"),'f');
  }],
  ['adjustment containment still detects removed column NOT NULL on PostgreSQL 17',async()=>{
   await query('alter table driver_settlement_adjustments alter column reason drop not null;');try{await assert.rejects(()=>query(settlementAdjustmentReleaseSql('contain')),/evidence or write boundary changed/);}
   finally{await query('alter table driver_settlement_adjustments alter column reason set not null;');}
  }],
  ['adjustments preserve financial rows on a late ledger failure',async()=>{
   const p=await payload(),before=await counts(),total=await query('select to_jsonb(s) from driver_settlements s where id='+q(i.settlement)+';');
   await query("create function qa_adjustment_fail() returns trigger language plpgsql as $$begin raise exception 'QA adjustment failure';end$$;create trigger z_qa_adjustment_fail after insert on driver_settlement_adjustments for each row execute function qa_adjustment_fail();");
   try{await assert.rejects(()=>query(call(p)),/QA adjustment failure/);}finally{await query('drop trigger z_qa_adjustment_fail on driver_settlement_adjustments;drop function qa_adjustment_fail();');}
   assert.equal(await counts(),before);assert.equal(await query('select to_jsonb(s) from driver_settlements s where id='+q(i.settlement)+';'),total);
  }],
  ['adjustments remove once with an immutable before image and unchanged payment history',async()=>{
   const p=await payload(),added=JSON.parse(await query(call(p))),remove={...await payload(),action:'remove',item_id:added.item_id,nature:null,amount_cents:null,description:null};
   const ack=JSON.parse(await query(call(remove)));assert.deepEqual(JSON.parse(await query(call(remove))),ack);assert.deepEqual(JSON.parse(await query(call(p))),added);
   assert.equal(await query('select count(*) from driver_settlement_items where id='+q(added.item_id)+';'),'0');assert.equal(await query('select count(*) from driver_settlement_payments where settlement_id='+q(i.settlement)+';'),'0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}assert.deepEqual(await snapshot(),initial);return tests.length;
}
