import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runLegacyReceiptNative({query,contested,literal:q,createRoles=false}){
 const database='finance_legacy_receipt_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','receivables','receivables_payments','bank_transactions','closing_reports','closing_report_payments','closing_report_history','client_invoices','payables','payables_payments','load_payments','employee_advances','driver_settlement_payments','payroll_entry_items']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);await run(`alter table ${table} add primary key(id)`);
 }
 await run(`alter table receivables add unique(tenant_id,id);alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;
 create schema storage;create table storage.objects(id uuid primary key,name text,bucket_id text);
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.apply_closing_report_action(jsonb) returns jsonb language plpgsql as $$begin raise exception 'qa_closing_not_enabled';end$$;`);
 for(const name of ['register_receivable_payment','reverse_receivable_payment','register_closing_report_payment']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];assert.ok(fn,name);await run(fn);
 }
 const preserve=readFileSync('supabase/migrations/20260830165149_make_closing_drafts_atomic.sql','utf8').match(/create function public\._preserve_closing_creation\([\s\S]*?\$fn\$;/)?.[0];assert.ok(preserve);await run(preserve);
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`;
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência de recebimento histórico QA'});
 const day='2026-01-01',fixtures=[];
 for(let n=0;n<16;n++){
  const client=randomUUID(),receivable=randomUUID(),other=randomUUID(),payment=randomUUID(),bank=randomUUID();
  await run(`insert into clients(id,tenant_id,company_name) values(${q(client)},${q(i.tenant)},'Cliente QA');
   insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount,received_at) values
    (${q(receivable)},${q(i.tenant)},${q(client)},'Recebível antigo',300,'received',300,'2026-01-01T15:00:00Z'),
    (${q(other)},${q(i.tenant)},${q(client)},'Outro recebível',300,'pending',0,null);
   insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values(${q(bank)},${q(i.tenant)},${q(i.account)},'2026-01-01T15:00:00Z',300,'credit','{}');
   insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,bank_transaction_id,created_by) values(${q(payment)},${q(i.tenant)},${q(receivable)},300,'2026-01-01T15:00:00Z',${q(i.account)},'pix',${q(bank)},${q(i.operator)});`);
  const movement=JSON.parse(await run(call('record_finance_movement',{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:50000,occurred_on:day,description:'Entrada agrupada já registrada',beneficiary_name:'Cliente QA'}))).movement_id;
  fixtures.push({client,receivable,other,payment,bank,movement});
 }
 async function install(file){const sql=readFileSync('supabase/migrations/'+file,'utf8');assert.ok(sql.trim(),file);await run('begin;'+sql+'commit;');console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 await install('20260830183929_audit_receivable_payments_and_reversals.sql');
 await run(`create trigger qa_recalc_receipt after insert or update or delete on receivables_payments for each row execute function _recalc_receivable_received();`);
 await install('20260910024438_finance_receivable_movement_projection.sql');
 await install('20260910025658_finance_receipt_allocation_corrections.sql');
 await install('20260910030634_finance_explicit_receipt_refunds.sql');
 // Read-only inventory dependencies: real definitions, no unrelated graph FKs.
 for(const [file,table] of [['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals'],['20260910011121_finance_fiscal_cancellation_credits','finance_customer_credits']]){
  let sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(sql,table);
  sql=sql.replace(/ references public\.\w+\([^)]*\)/g,'');await run(sql);
 }
 await install('20260910142740_finance_legacy_adoption_inventory.sql');
 await run(`create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);`);
 await install('20260909233625_finance_audit_queries.sql');
 await install('20260910145616_finance_legacy_receipt_associations.sql');
 const snapshot=f=>run(`select jsonb_build_object('receivable',(select to_jsonb(r) from receivables r where id=${q(f.receivable)}),'payment',(select to_jsonb(p) from receivables_payments p where id=${q(f.payment)}),'bank',(select to_jsonb(b) from bank_transactions b where id=${q(f.bank)}),'movement',(select to_jsonb(m) from finance_movements m where id=${q(f.movement)}))`);
 const association=p=>call('associate_finance_legacy_receivable_payment',p);
 const reverse=p=>call('reverse_finance_legacy_receivable_association',p);
 const race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 async function take(){const f=fixtures.shift();f.before=await snapshot(f);f.payload={...base(),payment_id:f.payment,movement_id:f.movement,revision:await run(`select finance_private.legacy_receivable_source_revision(${q(i.tenant)},${q(f.payment)})`),existing_receipt_confirmed:true};return f;}
 async function standard(f){const context=JSON.parse(await run(`${auth}select get_receivable_financial_context(${q(i.tenant)},${q(f.other)})`));return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:f.other,expected_revision:context.revision,action:'receive',reason:'Recebimento concorrente confirmado',amount_cents:30000,effective_date:day,bank_account_id:i.account,method:'pix',movement_id:f.movement};}
 async function invariant(f,active=1){assert.equal(await snapshot(f),f.before);assert.equal(await run(`select count(*) from finance_legacy_receipt_movement_links l where payment_id=${q(f.payment)} and not exists(select 1 from finance_legacy_receipt_link_reversals r where r.link_id=l.id)`),String(active));}
 const tests=[
  ['same request replays one association without new receipt or cash',async()=>{const f=await take();await race(association(f.payload),association(f.payload));await invariant(f);}],
  ['two requests for one receipt preserve one active association',async()=>{const f=await take();const result=await race(association(f.payload),association({...f.payload,request_id:randomUUID()}),{waiterSucceeds:false});assert.match(result.error,/already|exists|linked/);await invariant(f);}],
  ['association first blocks a real new receipt from exceeding the same input capacity',async()=>{const f=await take(),p=await standard(f);const result=await race(association(f.payload),call('apply_receivable_financial_command',p),{waiterSucceeds:false});assert.match(result.error,/capacity|overallocated/);await invariant(f);assert.equal(await run(`select count(*) from receivable_financial_commands where request_id=${q(p.request_id)}`),'0');}],
  ['real receipt first blocks legacy association without residual commands',async()=>{const f=await take(),p=await standard(f);const result=await race(call('apply_receivable_financial_command',p),association(f.payload),{waiterSucceeds:false});assert.match(result.error,/capacity|overallocated/);await invariant(f,0);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');}],
  ['reverse and reassociate preserve original received status and one active association',async()=>{const f=await take(),first=JSON.parse(await run(association(f.payload)));await race(reverse({...base(),link_id:first.link_id}),association({...f.payload,request_id:randomUUID()}));await invariant(f);}],
  ['revoked actor after advisory wait cannot associate a historic receipt',async()=>{const f=await take();const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,association(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(result.error,/access_denied|not_authorized/);await invariant(f,0);await run(`update tenant_memberships set active=true where user_id=${q(i.operator)}`);}],
  ['two different old receipts cannot overbook one canonical incoming movement',async()=>{const f=await take(),g=await take();const result=await race(association(f.payload),association({...g.payload,movement_id:f.movement}),{waiterSucceeds:false});assert.match(result.error,/capacity|overallocated/);await invariant(f);await invariant(g,0);}],
  ['legitimate source description change during wait rejects the preview revision',async()=>{
   const f=await take();const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,association(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update receivables set description='Referência revisada antes da associação' where id=${q(f.receivable)}`});assert.match(result.error,/40001: finance_legacy_receipt_changed/);
   assert.equal(await run(`select count(*) from finance_legacy_receipt_movement_links where payment_id=${q(f.payment)}`),'0');assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');
  }],
  ['real refund after association creates its own outflow and preserves reserved incoming capacity',async()=>{
   const f=await take();await run(association(f.payload));const context=JSON.parse(await run(`${auth}select get_receivable_financial_context(${q(i.tenant)},${q(f.receivable)})`));
   await run(call('apply_receivable_financial_command',{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:f.receivable,expected_revision:context.revision,action:'reverse',reason:'Devolução real comprovada de recebimento',payment_id:f.payment,effective_date:day,refund_kind:'money_returned'}));
   assert.equal(await run(`select finance_private.receipt_movement_used_cents(${q(i.tenant)},${q(f.movement)})`),'30000');
   const p=await standard(f);await assert.rejects(()=>run(call('apply_receivable_financial_command',p)),/capacity/);
   assert.equal(await run(`select count(*) from finance_movements m join finance_receivable_movement_links l on l.movement_id=m.id where l.payment_id=${q(f.payment)} and l.action='reverse' and m.direction='out' and m.amount_cents=30000`),'1');
   assert.equal(await run(`select count(*) from receivables_payments where id=${q(f.payment)}`),'1');
  }],
  ['canonical allocation correction releases capacity without creating money for association',async()=>{
   const f=await take(),receipt=JSON.parse(await run(call('apply_receivable_financial_command',await standard(f))));const context=JSON.parse(await run(`${auth}select get_receivable_financial_context(${q(i.tenant)},${q(f.other)})`));
   const correction={...base(),payment_id:receipt.payment_id,expected_revision:context.revision};await race(call('correct_finance_receipt_allocation',correction),association(f.payload));await invariant(f);
   assert.equal(await run(`select finance_private.receipt_movement_used_cents(${q(i.tenant)},${q(f.movement)})`),'30000');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
