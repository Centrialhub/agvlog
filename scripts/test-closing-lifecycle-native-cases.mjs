import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installClosingLifecycleFixture,closingLifecycleSql,seedClosingChargeFixture,closingChargeFixtureIds as f} from '../src/test/helpers/closingLifecycleDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runClosingLifecycleNative({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;const api=operator+'set role authenticated;';
 const adapter={exec:query,query:async(sql,params=[])=>{const body=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]));
  return {rows:JSON.parse(await query(operator+`with qa_result as (${body}) select coalesce(json_agg(to_jsonb(r)),'[]'::json) from qa_result r;`))};}};
 await installClosingLifecycleFixture(adapter);
 const day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 const filters={period_start:day,period_end:day,date_basis:'invoice_issue',client_id:f.client};
 const create=async()=>{const source=JSON.parse(await query(`${api}select get_closing_report_sources(${q(i.tenant)},${q(JSON.stringify(filters))}::jsonb);`));
  const p={version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),mode:'system',reason:'Conferência QA ciclo financeiro',
   header:{title:'QA ciclo',client_id:f.client,payer_client_id:null,report_type:'custom',report_model:'detailed',period_start:day,period_end:day},
   system:{filters,options:{allocation:'per_nf',only_with_cte:false},revision:source.revision}};
  return JSON.parse(await query(`${api}select create_closing_report_draft(${q(JSON.stringify(p))}::jsonb);`)).report.id;};
 const context=async report=>JSON.parse(await query(`${api}select get_closing_report_action_context(${q(i.tenant)},${q(report)});`));
 const payload=async(report,action='close')=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),report_id:report,action,expected_revision:(await context(report)).revision,reason:'Conferência QA ciclo financeiro'});
 const call=p=>`${api}select apply_closing_report_action(${q(JSON.stringify(p))}::jsonb);`;
 const claims=()=>query('select count(*) from closing_report_charge_claims where released_at is null;');
 const cte=f.cte;let first,second,third;
 const tests=[
  ['closing lifecycle migration preserves source evidence and installs explicit API ACLs',async()=>{
   const state=()=>query('select md5((select jsonb_agg(to_jsonb(d) order by id) from fiscal_documents d)::text);');const before=await state();const sql=closingLifecycleSql();
   await query('begin;'+sql+'commit;');assert.equal(await state(),before);console.log('Closing lifecycle candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   await seedClosingChargeFixture(adapter);
   first=await create();second=await create();assert.equal((await context(first)).source_review_required,false);
   assert.equal((await context(first)).total_amount,100,'The native claim test must use actual positive per-NF charges');
   assert.equal(await query("select has_function_privilege('anon','apply_closing_report_action(jsonb)','execute');"),'f');
  }],
  ['concurrent identical close requests acknowledge one transition and one audit',async()=>{
   const p=await payload(first);const result=await contested(call(p),call(p),{driver:false});assert.match(result.output,/"status": "closed"/);
   assert.equal((await context(first)).revision,1);assert.equal(await query(`select count(*) from closing_report_history where closing_report_id=${q(first)} and action='lifecycle_close';`),'1');
   assert.ok(Number(await claims())>0);
  }],
  ['a second report cannot charge the same delivery after the first close commits',async()=>{
   const before=await claims(),p=await payload(second);await assert.rejects(()=>query(call(p)),/23505.*already_reserved/);
   assert.equal(await claims(),before);assert.equal((await context(second)).status,'draft');
  }],
  ['held fiscal source rejects marking a send immediately without incrementing the revision',async()=>{
   const p=await payload(first,'mark_sent');const holder=session('closing-action-fiscal-holder');holder.send(`begin;update cte_documents set freight_value=300 where id=${q(cte)};select '__CLOSING_ACTION_FISCAL_HELD__';`);
   await waitForMarker(holder,'__CLOSING_ACTION_FISCAL_HELD__');try{await assert.rejects(()=>query(call(p)),/40001.*concurrent_change/);}finally{await finish(holder,'rollback;');}
   assert.equal((await context(first)).revision,1);
  }],
  ['concurrent cancellation releases claims once and preserves their history',async()=>{
   const before=await claims();const p=await payload(first,'cancel');await contested(call(p),call(p),{driver:false});
   assert.equal(await claims(),'0');assert.equal(await query('select count(*) from closing_report_charge_claims where released_at is not null;'),before);
   assert.equal((await context(first)).revision,2);
  }],
  ['competing closes for the same attempt fail fast while the winning claim is uncommitted',async()=>{
   third=await create();const winner=await payload(second),loser=await payload(third);const holder=session('closing-charge-holder');holder.send('begin;'+call(winner)+"select '__CLOSING_CHARGE_HELD__';");
   await waitForMarker(holder,'__CLOSING_CHARGE_HELD__');try{await assert.rejects(()=>query(call(loser)),/40001.*concurrent_change/);}finally{await finish(holder,'commit;');}
   assert.equal((await context(second)).status,'closed');assert.equal((await context(third)).status,'draft');
  }],
  ['direct CT-e billing cannot bypass a committed closing claim',async()=>{
   await assert.rejects(()=>query(`insert into client_invoice_charges(tenant_id,invoice_id,source_type,source_id) values(${q(i.tenant)},${q(randomUUID())},'cte_document',${q(cte)});`),/23505.*already_reserved/);
  }],
  ['direct CT-e billing and closing claims share a lock and cannot both win',async()=>{
   await query(call(await payload(second,'cancel')));const invoice=randomUUID();const client=f.client;
   await query(`insert into client_invoices(id,tenant_id,client_id,invoice_number,gross_amount,total_amount) values(${q(invoice)},${q(i.tenant)},${q(client)},'QA-NATIVE-CLAIM',100,100);`);
   const p=await payload(third);const holder=session('closing-invoice-charge-holder');holder.send(`begin;insert into client_invoice_charges(tenant_id,invoice_id,source_type,source_id,gross_amount,net_amount) values(${q(i.tenant)},${q(invoice)},'cte_document',${q(cte)},100,100);select '__CLOSING_INVOICE_HELD__';`);
   await waitForMarker(holder,'__CLOSING_INVOICE_HELD__');try{await assert.rejects(()=>query(call(p)),/40001.*concurrent_change/);}finally{await finish(holder,'commit;');}
   await assert.rejects(()=>query(call(p)),/23505.*already_invoiced/);assert.equal((await context(third)).status,'draft');
   await query(`update client_invoice_charges set cancelled_at=clock_timestamp() where invoice_id=${q(invoice)};`);
  }],
  ['membership revocation during an action-key wait prevents the transition',async()=>{
   const p=await payload(third);const lock=`select pg_advisory_xact_lock(hashtext('closing-report-action'),hashtext(${q(i.tenant+':'+i.operator+':'+p.request_id)}))`;
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(result.error,/42501.*not_authorized/);}
   finally{await query(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}
   assert.equal((await context(third)).status,'draft');
  }],
  ['durable acknowledgement failure rolls back all claims and the report state',async()=>{
   const p=await payload(third);await query("create function qa_fail_closing_action() returns trigger language plpgsql as $$begin raise exception 'QA action failure';end;$$;create trigger qa_fail_closing_action before insert on closing_report_action_requests for each row execute function qa_fail_closing_action();");
   try{await assert.rejects(()=>query(call(p)),/QA action failure/);}finally{await query('drop trigger qa_fail_closing_action on closing_report_action_requests;drop function qa_fail_closing_action();');}
   assert.equal(await claims(),'0');assert.equal((await context(third)).revision,0);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
