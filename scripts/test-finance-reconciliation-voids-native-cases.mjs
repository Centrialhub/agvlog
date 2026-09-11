import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
import {ofxFile,ofxTransaction} from '../src/test/helpers/financeOfxFixture.ts';
import {readOfxStatement} from '../supabase/functions/_shared/finance-ofx-reader.ts';
import {verifyStatementSource} from '../supabase/functions/finance-statement-verify/worker.ts';
import {reconciliationOptionsSchema} from '../src/lib/financial/reconciliationContract.ts';
import {reconciliationHistorySchema} from '../src/lib/financial/reconciliationHistoryContract.ts';
export async function runReconciliationVoidsNative({query,contested,literal:q,createRoles=false}){
 const database='finance_reconciliation_voids_qa';await query('create database '+database);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`alter table bank_accounts add column account_number text,add column bank_code text,add column branch_number text,add column account_type text;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated;
 create function finance_private.can_read_receipt(_path text) returns boolean language sql security definer set search_path='' as $$select finance_private.can_access(split_part(_path,'/',1)::uuid)$$;
 grant execute on function finance_private.can_read_receipt(text) to authenticated,anon;grant usage on schema finance_private to anon;`);
 const names=[...readFileSync('src/test/helpers/setupFinanceStatementIntakeDatabase.ts','utf8').matchAll(/'(2026[^']+\.sql)'/g)].map(m=>m[1]);
 for(const file of [...names,'20260910182541_finance_movement_correction_foundation.sql','20260910182830_finance_movement_correction_history.sql','20260910183442_finance_reconciliation_active_movements.sql','20260910184213_finance_movement_active_reference.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const call=(fn,p)=>`${auth}select ${fn}(${q(JSON.stringify(p))}::jsonb)`;
 const race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 const reject=async(sql,message)=>assert.rejects(()=>run(sql),e=>String(e).includes(message));
 async function source(reference){
  const bytes=new TextEncoder().encode(ofxFile(ofxTransaction(reference))),hash=createHash('sha256').update(bytes).digest('hex'),path=`${i.tenant}/imports/${hash}.ofx`;
  await run(`update bank_accounts set bank_code='001',branch_number='1234',account_number='000123-4',account_type='checking' where id=${q(i.account)};insert into storage.objects(bucket_id,name,metadata) values('finance-statements',${q(path)},'{"size":1000,"mimetype":"application/x-ofx"}');`);
  const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,file_hash:hash,source_path:path,file_name:'native.ofx',currency:'BRL',parser_version:'native-ofx-v1',mapping:{date:'Data',amount:'Valor'},period_start:'2026-09-01',period_end:'2026-09-30',reason:'Original sintético recebido para teste',rows:readOfxStatement(bytes).rows};
  const s=JSON.parse(await run(call('intake_finance_statement',p)));
  const context=JSON.parse(await run(`${auth}select inspect_finance_statement_source(${q(i.tenant)},${q(s.import_id)})`));
  await verifyStatementSource({tenant:i.tenant,actor:i.operator,importId:s.import_id,request:randomUUID()},{inspect:async()=>context,download:async()=>bytes,workbook:async()=>{throw Error('unexpected workbook');},authorize:async()=>true,record:report=>run(`set role service_role;select record_finance_statement_verification(${q(JSON.stringify(report))}::jsonb)`)});
  return {...s,entry:await run(`select id from finance_bank_entries where first_import_id=${q(s.import_id)}`)};
 }
 async function movement(reference){const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-09-09',description:'Pagamento QA',beneficiary_name:'Motorista',bank_reference:reference,reason:'Registro conferido no ensaio'};return {...JSON.parse(await run(call('record_finance_movement',p))),request:p.request_id};}
 async function voidOwner(m){const request=randomUUID();await run(`insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(${q(i.tenant)},${q(request)},${q(i.operator)},'qa_void_storage','{}','{}');insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values(${q(i.tenant)},${q(m.movement_id)},${q(m.request)},${q(request)},'void',${q(i.operator)},'QA','Owner fixture sem void público',md5('qa'),jsonb_build_object('movement_id',${q(m.movement_id)}::text));`);}
 const options=async s=>reconciliationOptionsSchema.parse(JSON.parse(await run(`${auth}select list_finance_reconciliation_options(${q(i.tenant)},${q(s.import_id)},'movements','',1)`)));
 const context=(m,s)=>`${auth}select get_finance_reconciliation_context(${q(i.tenant)},array[${q(m.movement_id)}::uuid],array[${q(s.entry)}::uuid])`;
 const history=async s=>reconciliationHistorySchema.parse(JSON.parse(await run(`${auth}select list_finance_reconciliation_history(${q(i.tenant)},${q(s.import_id)},1)`)));
 const bankSnapshot=()=>run("select jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by id) from finance_bank_entries e),'rows',(select jsonb_agg(to_jsonb(r) order by id) from finance_statement_rows r))");
 let passed=0;
 const m=await movement('void-alone'),s=await source('void-alone'),before=await bankSnapshot();assert.ok((await options(s)).rows.some(r=>r.id===m.movement_id));await voidOwner(m);assert.ok(!(await options(s)).rows.some(r=>r.id===m.movement_id));await reject(context(m,s),'finance_reconciliation_selection_unavailable');assert.equal(await run('select finance_private.run_automatic_reconciliation_queue()'),'0');assert.equal(await bankSnapshot(),before);passed++;console.log('PASS real OFX worker + void candidate/context/automatic exclusion, unchanged statement');
 const old=await movement('replacement'),r=await source('replacement');await voidOwner(old);const fresh=await movement('replacement');assert.equal(await run('select finance_private.run_automatic_reconciliation_queue()'),'1');assert.equal(await run(`select movement_ids[1] from finance_reconciliation_groups where bank_entry_ids@>array[${q(r.entry)}::uuid]`),fresh.movement_id);assert.equal((await history(r)).rows[0].evidence_issue,null);passed++;console.log('PASS sole active reference matched by real automation');
 const group=(await history(r)).rows[0].id,snapshot=await run(`select evidence_snapshot from finance_reconciliation_groups where id=${q(group)}`),bankBefore=await bankSnapshot();await voidOwner(fresh);assert.equal((await history(r)).rows[0].evidence_issue,'movement_inactive');await run(call('reverse_finance_bank_reconciliation',{version:1,tenant_id:i.tenant,request_id:randomUUID(),group_id:group,reason:'Revisão da representação inválida'}));assert.ok((await history(r)).rows[0].reversal);assert.equal(await run(`select evidence_snapshot from finance_reconciliation_groups where id=${q(group)}`),snapshot);assert.equal(await bankSnapshot(),bankBefore);passed++;console.log('PASS inactive historical evidence and real reversal preserve source/snapshot');
 const copy=`insert into finance_reconciliation_groups select gen_random_uuid(),tenant_id,bank_account_id,direction,amount_cents,movement_ids,bank_entry_ids,method,actor_id,actor_name,reason,account_evidence,evidence_snapshot,created_at from finance_reconciliation_groups where id=${q(group)}`;
 await run(`create table qa_rejection(state text,message text);do $$begin begin ${copy};raise exception 'expected rejection';exception when check_violation then if sqlerrm<>'finance_reconciliation_movement_inactive' then raise;end if;insert into qa_rejection values(sqlstate,sqlerrm);end;end$$`);assert.equal(await run('select state from qa_rejection'),'23514');passed++;console.log('PASS residual group INSERT rejects inactive movement with23514');
 // Row lock comes first; the finance holder waits for that row. Inserting a
 // group from the row holder must fail40001 instead of waiting back on finance.
 const lock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant)}::text||':finance',0));`;
 await race(`select 1 from finance_reconciliation_groups where id=${q(group)} for update`,`${lock}select 1 from finance_reconciliation_groups where id=${q(group)} for update`,{holderAfterBlocked:`do $$begin begin ${copy};raise exception 'expected busy';exception when serialization_failure then if sqlerrm<>'finance_dependency_busy' then raise;end if;insert into qa_rejection values(sqlstate,sqlerrm);end;end$$`});assert.equal(await run("select count(*) from qa_rejection where state='40001' and message='finance_dependency_busy'"),'1');assert.equal(await run('select count(*) from finance_reconciliation_groups'),'1');assert.equal(await bankSnapshot(),bankBefore);passed++;console.log('PASS row-first residual group conflict40001 and no deadlock or statement changes');
 return passed;
}
