import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installClosingDraftFixture,closingDraftSql} from '../src/test/helpers/closingDraftDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runClosingDraftsNative({query,session,finish,waitForMarker,contested,literal:q}){
 const operator=`set request.jwt.claim.sub=${q(i.operator)};`;const api=operator+'set role authenticated;';
 const adapter={exec:query,query:async(sql,params=[])=>{const body=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]));
  return {rows:JSON.parse(await query(operator+`with qa_result as (${body}) select coalesce(json_agg(to_jsonb(r)),'[]'::json) from qa_result r;`))};}};
 await installClosingDraftFixture(adapter);
 const day=await query("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD');");
 const filters={period_start:day,period_end:day,date_basis:'delivery_result'};
 const source=async()=>JSON.parse(await query(`${api}select get_closing_report_sources(${q(i.tenant)},${q(JSON.stringify(filters))}::jsonb);`));
 const payload=async()=>({version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),mode:'system',reason:'Conferência QA do fechamento',
  header:{title:'QA nativo',client_id:null,payer_client_id:null,report_type:'custom',report_model:'detailed',period_start:day,period_end:day},
  system:{filters,options:{allocation:'per_nf',only_with_cte:false},revision:(await source()).revision}});
 const call=p=>`${api}select create_closing_report_draft(${q(JSON.stringify(p))}::jsonb);`;
 const count=()=>query('select count(*) from closing_reports;');
 const cte="'ce000000-0000-4000-8000-000000000051'";
 const tests=[
  ['atomic closing candidate applies without altering operational/fiscal evidence',async()=>{
   const state=()=>query('select md5((select jsonb_agg(to_jsonb(d) order by id) from fiscal_documents d)::text);');const before=await state();
   const sql=closingDraftSql();await query('begin;'+sql+'commit;');assert.equal(await state(),before);
   console.log('Closing drafts candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
  }],
  ['concurrent identical creation requests wait and acknowledge exactly one report',async()=>{
   const p=await payload();const result=await contested(call(p),call(p),{driver:false});assert.match(result.output,/"status": "confirmed"/);
   assert.equal(await count(),'1');assert.equal(await query('select count(*) from closing_report_creation_requests;'),'1');
   assert.equal(await query('select count(*) from closing_report_history;'),'1');
  }],
  ['durable creation replay survives source changes but rejects a changed body',async()=>{
   const p=await payload();const first=JSON.parse(await query(call(p)));await query(`update cte_documents set freight_value=251 where id=${cte};`);
   assert.deepEqual(JSON.parse(await query(call(p))),first);
   await assert.rejects(()=>query(call({...p,reason:'Motivo diferente do pedido original'})),/22023.*key_mismatch/);
  }],
  ['held fiscal source rejects a competing creation immediately without a partial report',async()=>{
   const p=await payload();const before=await count();const holder=session('closing-draft-fiscal-holder');holder.send(`begin;update cte_documents set freight_value=300 where id=${cte};select '__CLOSING_DRAFT_HELD__';`);
   await waitForMarker(holder,'__CLOSING_DRAFT_HELD__');try{await assert.rejects(()=>query(call(p)),/40001.*concurrent_change/);}finally{await finish(holder,'rollback;');}
   assert.equal(await count(),before);assert.equal(await query(`select count(*) from closing_report_creation_requests where request_id=${q(p.request_id)};`),'0');
  }],
  ['source writes serialize behind a creating report snapshot',async()=>{
   const p=await payload();await contested(call(p),`update cte_documents set freight_value=252 where id=${cte}`,{driver:false});
   assert.equal(await query(`select count(*) from closing_report_creation_requests where request_id=${q(p.request_id)};`),'1');
  }],
  ['membership revocation during the request-key wait prevents creation',async()=>{
   const p=await payload();const before=await count();const lock=`select pg_advisory_xact_lock(hashtext('create_closing_report_draft'),hashtext(${q(i.tenant+':'+i.operator+':'+p.request_id)}))`;
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});
    assert.match(result.error,/42501.*not_authorized/);assert.equal(await count(),before);
   }finally{await query(`update tenant_memberships set active=true where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)};`);}
  }],
  ['different requests serialize numbering without duplicate closing numbers',async()=>{
   const first=await payload(),second=await payload();await contested(call(first),call(second),{driver:false});
   assert.equal(await query('select count(*)=count(distinct closing_number) from closing_reports;'),'t');
  }],
  ['browser DML and anonymous creation are denied after the atomic writer cutover',async()=>{
   await assert.rejects(()=>query(api+"update closing_reports set title='forged';"),/42501.*permission denied/);
   assert.equal(await query("select has_function_privilege('anon','create_closing_report_draft(jsonb)','execute');"),'f');
   const p=await payload();await assert.rejects(()=>query(call({...p,actor_id:i.user})),/42501.*not_authorized/);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
