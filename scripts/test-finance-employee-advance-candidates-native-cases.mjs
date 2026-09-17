import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {financeIds as ids} from '../src/test/helpers/financeLedgerDatabase.ts';

const candidateHashes={
 '20260911124237_finance_employee_advance_canonical_payment.sql':'9794198e06324fbf7a81e078b41a1f43533e787483b3027e8489554b2ed50e0b',
 '20260911124625_finance_payroll_recorded_employee_advances.sql':'d1fe06b0135c069575ae31b1e648a69eadc773eeafd1b0ce8671069377b4e8a9',
 '20260911125548_finance_employee_advance_audited_lifecycle.sql':'87f05f5259aaad61643cb2b34a4c1bdbdfb0d37a50876083254561a93a539701',
 '20260914191353_finance_employee_advance_public_catalog.sql':'a66b14f3ee7ab6ead539b49ba4561b8fd0c4a2380000f4902becb74bbaf70901',
};

export async function runEmployeeAdvanceCandidatesNative({query,contested,literal:q,session,finish}){
 for(const [file,hash] of Object.entries(candidateHashes))assert.equal(createHash('sha256').update(readFileSync(`supabase/migrations/${file}`)).digest('hex'),hash,file);
 const database='finance_employee_advance_candidates_qa';await query(`create database ${database}`);const connection=session('employee-advance-candidates-fixture',database);
 async function execute(sql){
  const marker=`__QA_${randomUUID().replaceAll('-','')}__`,offset=connection.output.length;connection.send(`${sql};select ${q(marker)};`);const deadline=Date.now()+60000;
  while(!connection.output.slice(offset).includes(marker)){assert.ok(!connection.exited,connection.error);assert.ok(Date.now()<deadline,`Fixture SQL timeout: ${sql.slice(0,180)}`);await delay(10);}
  return connection.output.slice(offset,connection.output.indexOf(marker,offset));
 }
 const sqlLiteral=value=>value==null?'null':typeof value==='boolean'?String(value):typeof value==='number'?String(value):q(typeof value==='object'?JSON.stringify(value):value);
 const db={exec:execute,query:async(sql,params=[])=>{sql=sql.replace(/\$(\d+)/g,(_,number)=>sqlLiteral(params[Number(number)-1])).replace(/;\s*$/,'');if(!/^\s*(select|with)\b/i.test(sql)&&!/\breturning\b/i.test(sql)){await execute(sql);return{rows:[]};}const wrapped=/^\s*(insert|update|delete)\b/i.test(sql)?`with qa_rows as (${sql}) select coalesce(json_agg(qa_rows),'[]')::text from qa_rows`:`select coalesce(json_agg(qa_rows),'[]')::text from (${sql}) qa_rows`;return{rows:JSON.parse((await execute(wrapped)).trim()||'[]')};},close:async()=>{}};
 const bundle=await build({entryPoints:['src/test/helpers/employeeAdvanceCandidatesNativeFixture.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'native-sql-transport',setup(builder){builder.onResolve({filter:/^@electric-sql\/pglite$/},()=>({path:'native-pglite',namespace:'native'}));builder.onLoad({filter:/.*/,namespace:'native'},()=>({contents:'export class PGlite {constructor(){return globalThis.__employeeAdvanceCandidatesNativeDb}}',loader:'js'}));}}]});
 globalThis.__employeeAdvanceCandidatesNativeDb=db;const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);await module.exports.prepareEmployeeAdvanceCandidatesNativeFixture();await finish(connection,'');delete globalThis.__employeeAdvanceCandidatesNativeDb;

 const identity=`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);`,auth=`${identity}set role authenticated;`,run=sql=>query(sql,database),json=async sql=>JSON.parse((await run(sql)).split('\n').filter(Boolean).at(-1));
 const base=tenant=>({version:1,tenant_id:tenant,request_id:randomUUID()});
 const call=(name,payload)=>`${auth}select ${name}(${q(JSON.stringify(payload))}::jsonb);`;
 const race=(first,second,options={})=>contested(first,second,{database,driver:false,...options});
 async function employee(tenant=ids.tenant,name='Funcionário QA'){
  const id=randomUUID();await run(`insert into employees(id,tenant_id,name) values(${q(id)},${q(tenant)},${q(name)});insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values(${q(tenant)},${q(id)},'fixed','2026-01-01',1000)`);return{id,name};
 }
 const registration=(tenant,employeeId)=>({...base(tenant),employee_id:employeeId,amount_cents:'10000',advance_date:'2026-09-14',reason:'Cadastro auditado do adiantamento no teste PostgreSQL',payment_method:'pix',payment_reference:null,create_payable:false});
 async function registered(tenant=ids.tenant,name='Funcionário QA'){
  const person=await employee(tenant,name),command=registration(tenant,person.id),result=await json(call('record_finance_employee_advance',command));return{tenant,person,command,advance:result.advance_id,result};
 }
 async function approve(source){
  const preview=await json(`${auth}select preview_finance_employee_advance_action(${q(source.tenant)},${q(source.advance)},'approve');`);assert.equal(preview.can_execute,true,JSON.stringify(preview.blockers));
  const command={...base(source.tenant),advance_id:source.advance,action:'approve',expected_revision:preview.revision,reason:'Aprovação auditada do adiantamento no teste PostgreSQL'};return{command,result:await json(call('apply_finance_employee_advance_action',command))};
 }
 async function movement(source,amount){
  return(await json(call('record_finance_movement',{...base(source.tenant),bank_account_id:source.tenant===ids.tenant?ids.account:ids.otherAccount,direction:'out',nature:'payment',amount_cents:amount,occurred_on:'2026-09-14',description:'Pagamento real do adiantamento',beneficiary_name:source.person.name,beneficiary_document:null,reason:'Movimento bancário conferido para o adiantamento'}))).movement_id;
 }
 async function payment(source,movementId,amount,requestId=randomUUID()){
  const preview=await json(`${auth}select preview_finance_employee_advance_payment(${q(source.tenant)},${q(source.advance)},${q(movementId)},${q(String(amount))});`);assert.equal(preview.can_execute,true,JSON.stringify(preview.blockers));
  return{...base(source.tenant),request_id:requestId,advance_id:source.advance,movement_id:movementId,amount_cents:String(amount),expected_revision:preview.revision,method:'pix',reason:'Pagamento parcial auditado do adiantamento no PostgreSQL'};
 }
 async function approved(tenant=ids.tenant,name='Funcionário QA'){const source=await registered(tenant,name);await approve(source);return source;}
 async function generate(source){return (await run(`${auth}select generate_payroll_period(${q(source.tenant)},'2026-09-01','2026-09-30')`)).split(/\r?\n/).filter(Boolean).at(-1).trim();}
 async function payrollEntry(period,employeeId){return JSON.parse(await run(`select row_to_json(x) from(select id,already_paid_amount::text,amount_to_pay::text from payroll_entries where payroll_period_id=${q(period)} and employee_id=${q(employeeId)})x`));}
 let passed=0;const pass=label=>{console.log(`PASS ${label}`);passed++;};

 const permissions=await json(`select json_build_object('public_count',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=any(array['record_finance_employee_advance','preview_finance_employee_advance_payment','record_finance_employee_advance_payment','get_finance_employee_advance_payment_options','get_finance_employee_advance_payment_history','preview_finance_employee_advance_action','apply_finance_employee_advance_action'])),'public_auth',(select bool_and(has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') and not prosecdef) from pg_proc where pronamespace='public'::regnamespace and proname=any(array['record_finance_employee_advance','preview_finance_employee_advance_payment','record_finance_employee_advance_payment','get_finance_employee_advance_payment_options','get_finance_employee_advance_payment_history','preview_finance_employee_advance_action','apply_finance_employee_advance_action'])),'raw_count',(select count(*) from pg_proc where pronamespace='finance_private'::regnamespace and proname=any(array['record_employee_advance','employee_advance_action_context','apply_employee_advance_action','employee_advance_payment_context','record_employee_advance_payment','employee_advance_payment_options','employee_advance_payment_history'])),'raw_locked',(select bool_and(not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where pronamespace='finance_private'::regnamespace and proname=any(array['record_employee_advance','employee_advance_action_context','apply_employee_advance_action','employee_advance_payment_context','record_employee_advance_payment','employee_advance_payment_options','employee_advance_payment_history'])))`);
 assert.deepEqual(permissions,{public_count:7,public_auth:true,raw_count:7,raw_locked:true});pass('public catalog exposes seven invoker entrypoints while raw writers stay private');

 let person=await employee(),command=registration(ids.tenant,person.id),result=await race(call('record_finance_employee_advance',command),call('record_finance_employee_advance',command));const raced=JSON.parse(result.output.split('\n').filter(Boolean).at(-1)),replayed=await json(call('record_finance_employee_advance',command));assert.deepEqual(replayed,raced);assert.equal(await run(`select count(*) from employee_advances where tenant_id=${q(ids.tenant)} and employee_id=${q(person.id)}`),'1');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(command.request_id)} and action='employee_advance_registered'`),'1');assert.equal(await run('select count(*) from bank_transactions'),'0');
 pass('concurrent identical registration writes one audited advance and replays it');

 let source={tenant:ids.tenant,person,command,advance:replayed.advance_id,result:replayed};const actionPreview=await json(`${auth}select preview_finance_employee_advance_action(${q(source.tenant)},${q(source.advance)},'approve');`),action={...base(source.tenant),advance_id:source.advance,action:'approve',expected_revision:actionPreview.revision,reason:'Aprovação concorrente auditada do adiantamento'};result=await race(call('apply_finance_employee_advance_action',action),call('apply_finance_employee_advance_action',action));assert.deepEqual(await json(call('apply_finance_employee_advance_action',action)),JSON.parse(result.output.split('\n').filter(Boolean).at(-1)));assert.equal(await run(`select count(*) from finance_events where entity_id=${q(source.advance)} and action='employee_advance_approved'`),'1');assert.equal(await run(`select status from employee_advances where id=${q(source.advance)}`),'approved');
 pass('concurrent identical approval changes status and audits exactly once');

 source=await approved();let movementId=await movement(source,4000),paymentCommand=await payment(source,movementId,4000),before=await run(`select to_jsonb(m) from finance_movements m where id=${q(movementId)}`);result=await race(call('record_finance_employee_advance_payment',paymentCommand),call('record_finance_employee_advance_payment',paymentCommand));assert.deepEqual(await json(call('record_finance_employee_advance_payment',paymentCommand)),JSON.parse(result.output.split('\n').filter(Boolean).at(-1)));assert.equal(await run(`select count(*) from payables_payments p join employee_advances a on a.payable_id=p.payable_id where a.id=${q(source.advance)}`),'1');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(paymentCommand.request_id)} and action='employee_advance_payment'`),'1');assert.equal(await run(`select to_jsonb(m) from finance_movements m where id=${q(movementId)}`),before);assert.equal(await run(`select status||','||(finance_private.employee_advance_position(${q(source.tenant)},${q(source.advance)})->>'paid_cents') from employee_advances where id=${q(source.advance)}`),'approved,4000');
 pass('concurrent identical partial payment creates one link without creating or changing cash');

 source=await approved();movementId=await movement(source,4000);const firstPayment=await payment(source,movementId,4000),secondPayment={...firstPayment,request_id:randomUUID()};result=await race(call('record_finance_employee_advance_payment',firstPayment),call('record_finance_employee_advance_payment',secondPayment),{waiterSucceeds:false});assert.match(result.error,/40001[\s\S]*finance_advance_revision_changed/);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(secondPayment.request_id)}`),'0');assert.equal(await run(`select count(*) from payables_payments p join employee_advances a on a.payable_id=p.payable_id where a.id=${q(source.advance)}`),'1');
 pass('distinct concurrent payments cannot consume the same advance or movement twice');

 source=await approved();movementId=await movement(source,4000);paymentCommand=await payment(source,movementId,4000);await run(call('record_finance_employee_advance_payment',paymentCommand));let period=await generate(source),entry=await payrollEntry(period,source.person.id);assert.equal(entry.already_paid_amount,'40.00');movementId=await movement(source,2000);paymentCommand=await payment(source,movementId,2000);result=await race(`${auth}select approve_payroll_period(${q(period)})`,call('record_finance_employee_advance_payment',paymentCommand),{waiterSucceeds:false});assert.match(result.error,/finance_advance_materialized_in_payroll/);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(paymentCommand.request_id)}`),'0');assert.equal(await run(`select status from payroll_periods where id=${q(period)}`),'approved');
 pass('approved payroll wins the race and blocks a late advance payment atomically');

 source=await approved(ids.otherTenant,'Funcionário da outra empresa');movementId=await movement(source,4000);paymentCommand=await payment(source,movementId,4000);await run(call('record_finance_employee_advance_payment',paymentCommand));period=await generate(source);entry=await payrollEntry(period,source.person.id);movementId=await movement(source,2000);paymentCommand=await payment(source,movementId,2000);result=await race(call('record_finance_employee_advance_payment',paymentCommand),`${auth}select approve_payroll_period(${q(period)})`,{waiterSucceeds:false});assert.match(result.error,/40001[\s\S]*finance_payroll_advance_changed_recalculate/);await run(`${auth}select recalculate_payroll_entry(${q(entry.id)});select approve_payroll_period(${q(period)})`);entry=await payrollEntry(period,source.person.id);assert.equal(entry.already_paid_amount,'60.00');assert.equal(entry.amount_to_pay,'940.00');
 pass('payment winner makes approval stale until explicit recalculation captures the exact total');

 source=await approved();movementId=await movement(source,4000);paymentCommand=await payment(source,movementId,4000);result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(source.tenant+':finance')},0))`,call('record_finance_employee_advance_payment',paymentCommand),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(source.tenant)} and user_id=${q(ids.operator)}`});assert.match(result.error,/42501[\s\S]*finance_access_denied/);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(paymentCommand.request_id)}`),'0');await run(`update tenant_memberships set active=true where tenant_id=${q(source.tenant)} and user_id=${q(ids.operator)}`);
 pass('membership revoked while payment waits prevents every payment side effect');

 person=await employee(ids.otherTenant,'Funcionário outra empresa');command=registration(ids.otherTenant,person.id);await race(`select pg_advisory_xact_lock(hashtextextended(${q('fiscal:'+ids.tenant)},0));select pg_advisory_xact_lock(hashtextextended(${q(ids.tenant+':finance')},0))`,call('record_finance_employee_advance',command),{waitForBlocking:false});assert.equal(await run(`select count(*) from employee_advances where tenant_id=${q(ids.otherTenant)} and employee_id=${q(person.id)}`),'1');assert.equal(await run(`select count(*) from employee_advances where tenant_id=${q(ids.tenant)} and employee_id=${q(person.id)}`),'0');
 pass('fiscal and finance locks remain tenant-scoped during registration');

 for(const [file,hash] of Object.entries(candidateHashes))console.log(`CANDIDATE ${file} SHA256 ${hash}`);return passed;
}
