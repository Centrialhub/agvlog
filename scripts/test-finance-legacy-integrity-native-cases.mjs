import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runLegacyIntegrityNative({query,literal:q,createRoles=false}){
 const database='finance_legacy_integrity_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','receivables','receivables_payments','bank_transactions','closing_reports','closing_report_payments','closing_report_history','client_invoices','payables','payables_payments','load_payments','employee_advances','driver_settlement_payments','payroll_entry_items','driver_settlements','loads','employees','payroll_entries','payroll_periods','bank_statement_imports','financial_obligations']){
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
 const expected=new Map();
 const undated=randomUUID();expected.set(undated,'payroll_entry_items');
 await run(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values(${q(undated)},${q(i.tenant)},gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'other','already_paid','Sem datas',123)`);
 const infinite=fixtures[0],crossAccount=fixtures[1],wrongAlias=fixtures[2],wrongDate=fixtures[3],orphanAccount=fixtures[4];
 expected.set(infinite.payment,'receivables_payments');expected.set(crossAccount.payment,'receivables_payments');expected.set(wrongDate.bank,'bank_transactions');expected.set(orphanAccount.payment,'receivables_payments');
 // Reverse diagnostics: the bank/payment counterpart is also inconsistent.
 expected.set(infinite.bank,'bank_transactions');expected.set(crossAccount.bank,'bank_transactions');expected.set(wrongDate.payment,'receivables_payments');expected.set(orphanAccount.bank,'bank_transactions');expected.set(wrongAlias.bank,'bank_transactions');
 await run(`update receivables_payments set received_at='infinity' where id=${q(infinite.payment)};
 update receivables_payments set bank_account_id=${q(i.otherAccount)} where id=${q(crossAccount.payment)};
 update bank_transactions set posted_at='2026-02-01T15:00:00Z' where id=${q(wrongDate.bank)};
 update receivables_payments set bank_account_id=gen_random_uuid() where id=${q(orphanAccount.payment)};`);
 const alias=randomUUID(),aliasLoad=randomUUID();await run(`insert into loads(id,tenant_id,load_number,status) values(${q(aliasLoad)},${q(i.tenant)},'QA-ALIAS','draft')`);expected.set(alias,'load_payments');await run(`insert into load_payments(id,tenant_id,load_id,receivable_id,payment_date,amount,bank_account_id,receivable_payment_id,bank_transaction_id) values(${q(alias)},${q(i.tenant)},${q(aliasLoad)},${q(wrongAlias.receivable)},'2026-01-01',99,${q(i.account)},${q(wrongAlias.payment)},${q(wrongAlias.bank)})`);
 const foreign=randomUUID();await run(`insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method) values(${q(foreign)},${q(i.otherTenant)},gen_random_uuid(),10,'2026-01-01T15:00:00Z',${q(i.otherAccount)},'pix')`);
 const unknownIds=[];
 for(let n=0;n<31;n++){const id=randomUUID();unknownIds.push(id);expected.set(id,'payroll_entry_items');await run(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values(${q(id)},${q(i.tenant)},gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'other','already_paid','Sem fonte nem data',123)`);}
 await run(`update payroll_entry_items set source_id=gen_random_uuid(),source_table=null where id=${q(unknownIds[0])}`);
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
 await install('20260910151011_finance_legacy_integrity_inventory.sql');
 const read=async(page=1,actor=i.operator)=>JSON.parse(await run(`set request.jwt.claim.sub=${q(actor)};set role authenticated;select get_finance_legacy_integrity_inventory(${q(i.tenant)},${page})`));
 const all=[];const first=await read();
 for(let page=1;page<=Math.max(1,Math.ceil(first.total/30));page++){
  const result=page===1?first:await read(page);assert.equal(result.total,first.total);assert.equal(result.page,page);assert.equal(result.page_size,30);assert.equal(result.can_close,false);assert.equal(result.legacy_integration_status,'not_reviewed');
  assert.equal(result.unknown_account.not_additive_across_accounts,true);assert.equal(result.unknown_account.scope,'tenant');
  const rows=[...result.identified_account.rows,...result.unknown_account.rows];assert.ok(result.identified_account.rows.length<=30);assert.ok(result.unknown_account.rows.length<=30);all.push(...rows);
 }
 const byId=new Map(all.map(row=>[row.source_id,row]));
 const tests=[
  ['every seeded exception is returned once across all pages, including 32 undated payroll sources',async()=>{
   assert.equal(all.length,first.total);assert.equal(new Set(all.map(row=>row.source_table+':'+row.source_id)).size,all.length);
   for(const [id,table] of expected)assert.equal(byId.get(id)?.source_table,table,'Missing seeded exception '+table+'/'+id);
   assert.deepEqual(all.map(row=>row.source_table+':'+row.source_id).sort(),[...expected].map(([id,table])=>table+':'+id).sort(),'Unexpected or omitted source in the complete diagnostic set');
   assert.deepEqual(all.filter(row=>unknownIds.includes(row.source_id)).map(row=>row.source_id).sort(),unknownIds.sort());
  }],
  ['undated and infinite sources are explicit instead of being assigned a fabricated date',async()=>{
   assert.equal(byId.get(undated).date_status,'missing');assert.equal(byId.get(undated).occurred_on,null);
   assert.equal(byId.get(infinite.payment).date_status,'nonfinite');assert.equal(byId.get(infinite.payment).occurred_on,null);
  }],
  ['orphan and cross-tenant account sources remain visible without exposing another tenant',async()=>{
   assert.notEqual(byId.get(orphanAccount.payment).account_status,'identified');assert.notEqual(byId.get(crossAccount.payment).account_status,'identified');assert.ok(!byId.has(foreign));
  }],
  ['inconsistent aliases and bank dates retain their exact source IDs and issue details',async()=>{
   assert.ok(byId.get(alias).issues.includes('receipt_alias_mismatch'));assert.ok(byId.get(wrongDate.bank).issues.includes('referencing_source_mismatch'));
  }],
  ['driver, mixed profile, foreign tenant and invalid page are rejected',async()=>{
   await assert.rejects(()=>read(1,i.driverUser),/finance_access_denied/);await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.driverUser)},'operator',true)`);await assert.rejects(()=>read(1,i.driverUser),/finance_access_denied/);
   await assert.rejects(()=>run(`${auth}select get_finance_legacy_integrity_inventory(${q(i.otherTenant)},1)`),/finance_access_denied/);await assert.rejects(()=>read(0),/invalid/);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}console.log('Compared '+expected.size+' seeded exception IDs against '+all.length+' returned source rows.');return tests.length;
}
