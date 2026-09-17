import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {financeIds as ids} from '../src/test/helpers/financeLedgerDatabase.ts';

export async function runReceivableRenegotiationNative({query,contested,literal:q,session,finish}){
 const migration='supabase/migrations/20260914214752_finance_receivable_renegotiation.sql';
 const hash=createHash('sha256').update(readFileSync(migration)).digest('hex');
 assert.equal(hash,'be1d0d96b3a0fcee3bf9b84b3dad067e19aabaf5da5a50f7a4c8beafd57ea05d');
 const database='finance_receivable_renegotiation_qa';
 await query(`create database ${database}`);
 const connection=session('receivable-renegotiation-fixture',database);
 async function execute(sql){
  const marker=`__QA_${randomUUID().replaceAll('-','')}__`,offset=connection.output.length;
  connection.send(`${sql};select ${q(marker)};`);
  const deadline=Date.now()+90000;
  while(!connection.output.slice(offset).includes(marker)){
   assert.ok(!connection.exited,connection.error);
   assert.ok(Date.now()<deadline,`Fixture SQL timeout: ${sql.slice(0,180)}`);
   await delay(10);
  }
  return connection.output.slice(offset,connection.output.indexOf(marker,offset));
 }
 const sqlLiteral=value=>value==null?'null':typeof value==='boolean'?String(value):typeof value==='number'?String(value):q(typeof value==='object'?JSON.stringify(value):value);
 const db={
  exec:execute,
  query:async(sql,params=[])=>{
   sql=sql.replace(/\$(\d+)/g,(_,number)=>sqlLiteral(params[Number(number)-1])).replace(/;\s*$/,'');
   if(!/^\s*(select|with)\b/i.test(sql)&&!/\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}
   const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)
    ?`with qa_rows as (${sql}) select coalesce(json_agg(qa_rows),'[]')::text from qa_rows`
    :`select coalesce(json_agg(qa_rows),'[]')::text from (${sql}) qa_rows`;
   return{rows:JSON.parse((await execute(wrapped)).trim()||'[]')};
  },
  close:async()=>{},
 };
 const bundle=await build({
  entryPoints:['src/test/helpers/receivableRenegotiationNativeFixture.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
  plugins:[{name:'native-sql-transport',setup(builder){
   builder.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));
   builder.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__receivableRenegotiationNativeDb}}',loader:'js'}));
  }}],
 });
 globalThis.__receivableRenegotiationNativeDb=db;
 globalThis.expect=value=>({toBe:expected=>assert.equal(value,expected)});
 const module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const source=await module.exports.prepareReceivableRenegotiationNativeFixture();
 await finish(connection,'');
 delete globalThis.__receivableRenegotiationNativeDb;
 delete globalThis.expect;

 const run=sql=>query(sql,database);
 const auth=(actor=ids.operator)=>`select set_config('request.jwt.claim.sub',${q(actor)},false);set role authenticated;`;
 const json=async sql=>JSON.parse((await run(sql)).split(/\r?\n/).filter(Boolean).at(-1));
 const target=async(amount=500)=>json(`insert into receivables(tenant_id,client_id,amount,received_amount,status,description,due_date) values(${q(ids.tenant)},${q(source.payer)},${amount},0,'pending','Renegociação nativa',current_date+30) returning to_json(id)`);
 const snapshot=id=>json(`${auth()}select public.get_receivable_financial_context(${q(ids.tenant)},${q(id)});`);
 const position=(id,actor=ids.operator)=>json(`${auth(actor)}select public.get_finance_receivable_installment_position(${q(ids.tenant)},${q(id)});`);
 const context=(id,proposal,actor=ids.operator,tenant=ids.tenant)=>json(`${auth(actor)}select public.get_finance_receivable_agreement_context(${q(tenant)},${q(id)},${q(JSON.stringify(proposal))}::jsonb);`);
 const proposal=(action,installments=[])=>({action,installments});
 const command=(id,action,revision,installments=[],request=randomUUID())=>({version:1,tenant_id:ids.tenant,request_id:request,receivable_id:id,action,expected_revision:revision,reason:'Renegociação aprovada e conferida pelo responsável',installments});
 const record=payload=>json(`${auth()}select public.record_finance_receivable_agreement(${q(JSON.stringify(payload))}::jsonb);`);
 const makeInstallments=(amounts,month=10)=>amounts.map((amount,index)=>{
  const dueOn=new Date(Date.UTC(2026,month+index-1,10));
  return {id:randomUUID(),amount_cents:String(amount),due_on:dueOn.toISOString().slice(0,10)};
 });
 const money=()=>json(`select json_build_object('receivables',(select count(*) from receivables),'payments',(select count(*) from receivables_payments),'reversals',(select count(*) from receivable_payment_reversals),'movements',(select count(*) from finance_movements),'bank_transactions',(select count(*) from bank_transactions))`);
 const receive=async(id,amount,extra={})=>{const s=await snapshot(id);return json(`${auth()}select public.apply_receivable_financial_command(${q(JSON.stringify({version:1,tenant_id:ids.tenant,actor_id:ids.operator,request_id:randomUUID(),receivable_id:id,expected_revision:s.revision,action:'receive',amount_cents:amount,effective_date:source.day,bank_account_id:ids.account,method:'pix',reason:'Recebimento real distribuído entre parcelas',...extra}))}::jsonb);`);};
 let passed=0;
 const pass=label=>{passed++;console.log(`PASS ${label}`);};

 const metadata=await json(`select json_build_object(
  'tables',(select count(*) from pg_class where oid=any(array['finance_private.receivable_agreement_events'::regclass,'finance_private.receivable_agreement_installments'::regclass,'finance_private.receivable_installment_allocations'::regclass]) and relrowsecurity),
  'table_acl',(select bool_and(not has_table_privilege('authenticated',oid,'select') and not has_table_privilege('anon',oid,'select') and not has_table_privilege('service_role',oid,'select')) from pg_class where oid=any(array['finance_private.receivable_agreement_events'::regclass,'finance_private.receivable_agreement_installments'::regclass,'finance_private.receivable_installment_allocations'::regclass])),
  'public_count',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=any(array['get_finance_receivable_agreement_context','record_finance_receivable_agreement','get_finance_receivable_installment_position','get_finance_receivable_agreement_history','get_finance_receivable_payment_installments','get_finance_closing_receivable_agreement'])),
  'public_acl',(select bool_and(prosecdef and proconfig=array['search_path=""']::text[] and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where pronamespace='public'::regnamespace and proname=any(array['get_finance_receivable_agreement_context','record_finance_receivable_agreement','get_finance_receivable_installment_position','get_finance_receivable_agreement_history','get_finance_receivable_payment_installments','get_finance_closing_receivable_agreement'])),
  'private_locked',(select bool_and(proconfig=array['search_path=""']::text[] and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where pronamespace='finance_private'::regnamespace and proname=any(array['receivable_agreement_current','receivable_installment_position','receivable_agreement_context','record_receivable_agreement','receivable_agreement_history','receivable_payment_installment_history','closing_receivable_agreement_position','prepare_receivable_installment_distribution','consume_receivable_installment_distribution','reverse_receivable_installment_distribution','allocate_receivable_cash','reverse_receivable_cash_allocation','allocate_receivable_credit','allocate_receivable_adjustment','verify_receivable_installment_chain','cash_forecast_collect_without_agreements'])),
  'triggers',(select count(*) from pg_trigger where not tgisinternal and tgname=any(array['preserve_receivable_agreement_event','preserve_receivable_agreement_installment','preserve_receivable_installment_allocation','aa_allocate_receivable_cash','aa_reverse_receivable_cash_allocation','aa_allocate_receivable_credit','aa_allocate_receivable_adjustment','verify_receivable_agreement_chain','verify_receivable_allocation_chain']))
 );`);
 assert.deepEqual(metadata,{tables:3,table_acl:true,public_count:6,public_acl:true,private_locked:true,triggers:9});
 await assert.rejects(()=>run(`set role anon;select public.get_finance_receivable_installment_position(${q(ids.tenant)},${q(source.target)});`),/42501[\s\S]*permission denied/);
 pass('three private RLS journals, sixteen private helpers, six authenticated wrappers and nine guards have explicit ACLs');

 let id=await target(),installments=makeInstallments([20000,30000]),ctx=await context(id,proposal('create',installments)),payload=command(id,'create',ctx.revision,installments),before=await money();
 assert.equal(ctx.eligible,true);let created=await record(payload);assert.deepEqual(await record(payload),created);await assert.rejects(()=>record({...payload,reason:'Mesmo request com conteúdo divergente'}),/23514[\s\S]*finance_agreement_request_conflict/);
 let pos=await position(id),after=await money();assert.deepEqual(after,before);assert.equal(pos.status,'active');assert.equal(pos.open_cents,'50000');assert.equal(pos.scheduled_open_cents,'50000');assert.equal(pos.unallocated_open_cents,'0');assert.equal(pos.requires_reallocation,false);assert.equal(pos.installments.length,2);assert.equal(await run(`select count(*) from receivables where id=${q(id)}`),'1');
 pass('agreement creation is idempotent and versions the single open receivable without cash or nominal changes');

 id=await target();installments=makeInstallments([25000,25000]);ctx=await context(id,proposal('create',installments));const winner=command(id,'create',ctx.revision,installments),loser=command(id,'create',ctx.revision,installments);
 const race=await contested(`${auth()}select public.record_finance_receivable_agreement(${q(JSON.stringify(winner))}::jsonb)`,`${auth()}select public.record_finance_receivable_agreement(${q(JSON.stringify(loser))}::jsonb)`,{database,driver:false,waiterSucceeds:false});
 assert.match(race.error,/40001[\s\S]*finance_agreement_changed/);assert.equal(await run(`select count(*) from finance_private.receivable_agreement_events where receivable_id=${q(id)}`),'1');assert.equal(await run(`select count(*) from finance_events where entity_type='receivable_agreement' and before_data->>'receivable_id'=${q(id)}`),'1');
 pass('two concurrent creates serialize to one agreement and one audit event; the stale contender is atomic');

 id=await target();installments=makeInstallments([10000,40000]);ctx=await context(id,proposal('create',installments));payload=command(id,'create',ctx.revision,installments);
 const blocked=await contested(`select pg_advisory_xact_lock(hashtextextended(${q('fiscal:'+ids.tenant)},0))`,`${auth()}select public.record_finance_receivable_agreement(${q(JSON.stringify(payload))}::jsonb)`,{database,driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)}`});
 assert.match(blocked.error,/42501[\s\S]*finance_access_denied/);assert.equal(await run(`select count(*) from finance_private.receivable_agreement_events where receivable_id=${q(id)}`),'0');assert.equal(await run(`select count(*) from finance_events where entity_type='receivable_agreement' and before_data->>'receivable_id'=${q(id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(ids.tenant)} and user_id=${q(ids.operator)}`);
 pass('membership revoked while the writer waits on the tenant lock leaves no journal or audit residue');

 id=await target();installments=makeInstallments([20000,30000]);ctx=await context(id,proposal('create',installments));await record(command(id,'create',ctx.revision,installments));pos=await position(id);
 const paid=await receive(id,15000,{installment_allocations:[{installment_id:installments[0].id,amount_cents:'15000'}],expected_agreement_revision:pos.revision});pos=await position(id);assert.deepEqual(pos.installments.map(item=>({cash:item.cash_cents,open:item.open_cents})),[{cash:'15000',open:'5000'},{cash:'0',open:'30000'}]);
 const reversed=await snapshot(id);await json(`${auth()}select public.apply_receivable_financial_command(${q(JSON.stringify({version:1,tenant_id:ids.tenant,actor_id:ids.operator,request_id:randomUUID(),receivable_id:id,expected_revision:reversed.revision,action:'reverse',payment_id:paid.payment_id,effective_date:source.day,refund_kind:'money_returned',reason:'Estorno financeiro real do recebimento distribuído'}))}::jsonb);`);pos=await position(id);assert.deepEqual(pos.installments.map(item=>({cash:item.cash_cents,open:item.open_cents})),[{cash:'0',open:'20000'},{cash:'0',open:'30000'}]);
 const paymentCount=await run(`select count(*) from receivables_payments where receivable_id=${q(id)}`);await assert.rejects(()=>run(`insert into receivables_payments(tenant_id,receivable_id,amount,received_at,bank_account_id) values(${q(ids.tenant)},${q(id)},1,clock_timestamp(),${q(ids.account)})`),/financial_versioned_command_required|finance_agreement_distribution_required/);assert.equal(await run(`select count(*) from receivables_payments where receivable_id=${q(id)}`),paymentCount);
 pass('cash allocation and reversal follow the exact installment while direct unversioned inserts stay blocked');

 id=await target();installments=makeInstallments([25000,25000]);ctx=await context(id,proposal('create',installments));await record(command(id,'create',ctx.revision,installments));pos=await position(id);
 const creditPreview=await json(`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);select finance_private.customer_credit_application_context(${q(ids.tenant)},${q(source.credit)},${q(id)},'10000',null);`);
 await json(`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);select finance_private.record_customer_credit_application(${q(JSON.stringify({version:1,tenant_id:ids.tenant,request_id:randomUUID(),credit_id:source.credit,receivable_id:id,application_id:null,action:'apply',amount_cents:'10000',expected_revision:creditPreview.revision,reason:'Crédito distribuído na segunda parcela',installment_allocations:[{installment_id:installments[1].id,amount_cents:'10000'}],expected_agreement_revision:pos.revision}))}::jsonb);`);pos=await position(id);
 const adjustmentPreview=await json(`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);select finance_private.receivable_balance_adjustment_context(${q(ids.tenant)},${q(id)},'discount','5000',${q(source.day)},null);`);
 await json(`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);select finance_private.record_receivable_balance_adjustment(${q(JSON.stringify({version:1,tenant_id:ids.tenant,request_id:randomUUID(),receivable_id:id,action:'apply',kind:'discount',adjustment_id:null,amount_cents:'5000',effective_on:source.day,expected_revision:adjustmentPreview.revision,reason:'Desconto distribuído na primeira parcela',installment_allocations:[{installment_id:installments[0].id,amount_cents:'5000'}],expected_agreement_revision:pos.revision}))}::jsonb);`);pos=await position(id);assert.equal(pos.installments[0].discount_cents,'5000');assert.equal(pos.installments[1].credit_cents,'10000');assert.equal(pos.scheduled_open_cents,'35000');assert.equal(pos.unallocated_open_cents,'0');assert.equal(await run(`select count(*) from receivables where id=${q(id)}`),'1');
 pass('credit and discount allocations reduce the intended installments without producing another receivable');

 id=await target();installments=makeInstallments([25000,25000]);ctx=await context(id,proposal('create',installments));await record(command(id,'create',ctx.revision,installments));let next=makeInstallments([30000,20000],12);ctx=await context(id,proposal('revise',next));await record(command(id,'revise',ctx.revision,next));ctx=await context(id,proposal('revoke',[]));await record(command(id,'revoke',ctx.revision,[]));pos=await position(id);assert.equal(pos.status,'revoked');const history=await json(`${auth()}select public.get_finance_receivable_agreement_history(${q(ids.tenant)},${q(id)},0,2,null);`);assert.equal(history.total,3);assert.equal(history.rows.length,2);assert.equal(history.next_offset,2);
 const event=await run(`select id from finance_private.receivable_agreement_events where receivable_id=${q(id)} order by created_at,id limit 1`),item=await run(`select id from finance_private.receivable_agreement_installments where receivable_id=${q(id)} order by ordinal limit 1`);await assert.rejects(()=>run(`update finance_private.receivable_agreement_events set reason=reason where id=${q(event)}`),/finance_immutable_record/);await assert.rejects(()=>run(`delete from finance_private.receivable_agreement_installments where id=${q(item)}`),/finance_immutable_record/);await assert.rejects(()=>run(`${auth()}select * from finance_private.receivable_agreement_events limit 1`),/42501[\s\S]*permission denied/);
 pass('revise and revoke append paged history while private events and installments remain immutable');

 id=await target();installments=makeInstallments([20000,30000]);ctx=await context(id,proposal('create',installments));payload=command(id,'create',ctx.revision,installments);await receive(id,10000);await assert.rejects(()=>record(payload),/40001[\s\S]*finance_agreement_changed/);
 await assert.rejects(()=>context(id,proposal('create',makeInstallments([40000])),ids.driverUser),/42501[\s\S]*finance_access_denied/);
 await assert.rejects(()=>context(id,proposal('create',makeInstallments([40000])),ids.operator,ids.otherTenant),/42501[\s\S]*finance_access_denied/);
 const tooMany=Array.from({length:101},(_,index)=>({id:randomUUID(),amount_cents:'1',due_on:`2027-01-${String(index%28+1).padStart(2,'0')}`}));
 await assert.rejects(()=>context(id,proposal('create',tooMany)),/22023[\s\S]*finance_agreement_invalid/);
 assert.equal(await run(`select count(*) from finance_private.receivable_agreement_events where receivable_id=${q(id)}`),'0');
 pass('source changes, drivers, foreign tenants and proposals above 100 installments fail without partial agreement state');

 console.log(`CANDIDATE ${migration} SHA256 ${hash}`);
 return passed;
}
