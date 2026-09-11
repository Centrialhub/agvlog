import assert from 'node:assert/strict';
import {unbilledFreightSummarySchema,unbilledFreightOriginsSchema} from '../src/lib/financial/unbilledFreightContract.ts';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runUnbilledFreightNative({query,contested,literal:q,createRoles=false}){
 const database='finance_unbilled_freight_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
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
 for(let n=0;n<0;n++){
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



 // Read-only inventory dependencies: real definitions, no unrelated graph FKs.
 for(const [file,table] of [['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals']]){
  let sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(sql,table);
  sql=sql.replace(/ references public\.\w+\([^)]*\)/g,'');await run(sql);
 }

 await run(`create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);`);



 await run(`create table cte_documents(id uuid primary key,tenant_id uuid,freight_value numeric,fiscal_document_ids uuid[]);create table fiscal_documents(id uuid primary key,tenant_id uuid,client_id uuid,freight_value numeric);
 alter table clients add column if not exists company_name text,add column if not exists tax_id text;
 alter table receivables add column if not exists cte_document_id uuid,add column if not exists fiscal_document_id uuid;
 alter table cte_documents add column if not exists client_id uuid,add column if not exists net_value numeric,add column if not exists payer_cnpj text;
 create table nfse_documents(id uuid primary key,tenant_id uuid,cliente_id uuid,pagador_cnpj text,cliente_cnpj text,
  valor_servicos numeric,valor_liquido numeric,valor_total numeric,iss_retido boolean,valor_iss numeric,outras_retencoes numeric,
  valor_pis numeric,valor_cofins numeric,valor_inss numeric,valor_ir numeric,valor_csll numeric,fiscal_document_ids uuid[],is_preview boolean);
 create table hub_fiscal_emissions(id uuid primary key,tenant_id uuid,doc_type text,environment text,status text,dispatch_state text,
  hub_document_id text,id_integracao text,emitter_cnpj text,access_key text,authorization_protocol text,number text,series text,
  provider_document_version bigint,provider_effect_id text,provider_occurred_at timestamptz,request_payload jsonb,
  cte_document_id uuid,fiscal_document_id uuid,nfse_document_id uuid,message text);
 `);
for(const file of ['20260910004550_finance_fiscal_observation_queue.sql','20260910005509_finance_fiscal_receivable_basis.sql','20260910010034_finance_fiscal_receivable_projection.sql','20260910011121_finance_fiscal_cancellation_credits.sql','20260910012152_finance_receivable_fiscal_context.sql','20260910024438_finance_receivable_movement_projection.sql','20260910025658_finance_receipt_allocation_corrections.sql','20260910030634_finance_explicit_receipt_refunds.sql','20260910142740_finance_legacy_adoption_inventory.sql','20260909233625_finance_audit_queries.sql','20260910145616_finance_legacy_receipt_associations.sql','20260910152711_finance_fiscal_dashboard_summary.sql'])await install(file);
 await run(`alter table fiscal_documents add column document_type text,add column status text,add column issue_date date,add column value numeric,add column is_duplicate boolean default false,add column deleted_at timestamptz,add column access_key text,add column current_delivery_attempt_id uuid,add column cte_emitted_outbound_id uuid,add column nfse_emitted_document_id uuid,add column cte_emitted_at timestamptz,add column nfse_emitted_at timestamptz;alter table cte_documents add column status text;alter table nfse_documents add column status text,add column cancelled boolean default false;create table fiscal_source_reservations(tenant_id uuid,environment text,source_id uuid,outbound_id uuid,nfse_id uuid,primary key(tenant_id,environment,source_id));`);
 for(const [file,table] of [['20260830135338_introduce_delivery_attempt_allocations','delivery_attempts'],['20260830174819_audit_closing_lifecycle_and_charge_claims','closing_report_charge_claims']]){let definition=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(definition);definition=definition.replace(/^\s*foreign key[^\n]*\r?\n/gm,'').replace(/ references public\.\w+\([^)]*\)/g,'');await run(definition);}
 const charges=baseline.match(/CREATE TABLE public\.client_invoice_charges \([\s\S]*?\n\);/)?.[0];assert.ok(charges);await run(charges);
 await install('20260910153731_finance_unbilled_freight_summary.sql');
 async function client(){const c=randomUUID();await run(`insert into clients(id,tenant_id,company_name,active) values(${q(c)},${q(i.tenant)},'Previsão QA',true)`);return c;}
 async function document(c,freight=100){const id=randomUUID();await run(`insert into fiscal_documents(id,tenant_id,document_type,status,client_id,issue_date,freight_value,value,is_duplicate) values(${q(id)},${q(i.tenant)},'inbound','pending',${q(c)},'2026-01-01',${freight===null?'null':freight},999999,false)`);return id;}
 async function emission(doc,status='authorized',dispatch='recorded'){const source=randomUUID(),id=randomUUID();await run(`insert into cte_documents(id,tenant_id,fiscal_document_ids,freight_value,status) values(${q(source)},${q(i.tenant)},array[${q(doc)}]::uuid[],100,${q(status)});insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values(${q(id)},${q(i.tenant)},'cte','production',${q(status)},${q(dispatch)},${q(source)},repeat('1',44),${status==='rejected'?'null':"repeat('2',15)"},'123')`);return {source,id};}
 const summary=(c,tenant=i.tenant)=>`select get_finance_unbilled_freight_summary(${q(tenant)},null,null,${q(c)}::uuid)`;
 const get=async c=>unbilledFreightSummarySchema.parse(JSON.parse(await run(auth+summary(c))));
 const rows=async(c,page=1)=>unbilledFreightOriginsSchema.parse(JSON.parse(await run(`${auth}select list_finance_unbilled_freight_origins(${q(i.tenant)},null,null,${q(c)}::uuid,null,${page})`)));
 const tests=[
 ['1005 exact invoice origins use freight not merchandise and all pages retain IDs',async()=>{const c=await client();await run(`insert into fiscal_documents(id,tenant_id,document_type,status,client_id,issue_date,freight_value,value,is_duplicate) select gen_random_uuid(),${q(i.tenant)},'inbound','pending',${q(c)},'2026-01-01',1.01,999999,false from generate_series(1,1005)`);const r=await get(c);assert.equal(r.total_origins,1005);assert.equal(r.forecast_cents,'101505');assert.equal(r.expected_receipt_date,null);const expected=(await run(`select string_agg(id::text,',' order by id) from fiscal_documents where client_id=${q(c)}`)).split(',');const found=[];for(let n=1;n<=34;n++)found.push(...(await rows(c,n)).rows.map(x=>x.document_id));assert.deepEqual(found,expected);}],
 ['authorized reserved and uncertain sources never enter available forecast',async()=>{const c=await client();await emission(await document(c));await emission(await document(c),'processing');await emission(await document(c),'processing','uncertain');const r=await get(c);assert.equal(r.authorized_count,1);assert.equal(r.reserved_count,1);assert.equal(r.uncertain_count,1);assert.equal(r.forecast_cents,'0');}],
 ['never authorized rejection releases but canceled authorization remains review through observation history',async()=>{const c=await client();await emission(await document(c),'rejected');const e=await emission(await document(c));await run(`update hub_fiscal_emissions set status='cancelled' where id=${q(e.id)};update cte_documents set fiscal_document_ids=null where id=${q(e.source)}`);const r=await get(c);assert.equal(r.available_count,1);assert.equal(r.review_count,1);assert.equal(r.forecast_cents,null);assert.ok((await rows(c)).rows.some(r=>r.issues.includes('cancelled_service_requires_review')));}],
 ['exact reservation in flight releases after rejection without creating money',async()=>{const c=await client(),doc=await document(c),out=randomUUID(),id=randomUUID();await run(`insert into fiscal_documents(id,tenant_id,document_type,status) values(${q(out)},${q(i.tenant)},'outbound','draft');insert into fiscal_source_reservations values(${q(i.tenant)},'production',${q(doc)},${q(out)},null);insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,fiscal_document_id) values(${q(id)},${q(i.tenant)},'cte','production','processing','in_flight',${q(out)})`);assert.equal((await get(c)).uncertain_count,1);await run(`update hub_fiscal_emissions set status='rejected',dispatch_state='recorded' where id=${q(id)}`);assert.equal((await get(c)).forecast_cents,'10000');assert.equal(await run('select count(*) from finance_movements'),'0');}],
 ['commercial claim requires allocation review and released claim restores availability',async()=>{const c=await client(),doc=await document(c);await run(`insert into closing_report_charge_claims(tenant_id,report_id,item_id,fiscal_document_id,amount,claimed_by) values(${q(i.tenant)},gen_random_uuid(),gen_random_uuid(),${q(doc)},50,${q(i.operator)})`);assert.equal((await get(c)).review_count,1);assert.ok((await rows(c)).rows[0].issues.includes('commercial_claim_requires_allocation_review'));await run(`update closing_report_charge_claims set released_at=now(),released_by=${q(i.operator)},release_reason='Cancelamento QA' where fiscal_document_id=${q(doc)}`);assert.equal((await get(c)).available_count,1);}],
 ['returned service and redelivery attempt do not inherit full original freight',async()=>{const c=await client(),doc=await document(c),attempt=randomUUID();await run(`update fiscal_documents set status='returned',current_delivery_attempt_id=${q(attempt)} where id=${q(doc)};insert into delivery_attempts(id,tenant_id,fiscal_document_id,previous_outcome_id,source_allocation_id,event_id,actor_id,reason,source_document_snapshot,source_items_snapshot,items,financial_snapshot) values(${q(attempt)},${q(i.tenant)},${q(doc)},gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),${q(i.operator)},'Reentrega QA','{}','[]','[{}]','{}')`);const r=await get(c);assert.equal(r.total_origins,2);assert.equal(r.review_count,2);assert.equal(r.forecast_cents,null);const a=(await rows(c)).rows.find(r=>r.attempt_id===attempt);assert.equal(a.freight_cents,null);assert.deepEqual(a.issues,['unpriced_redelivery']);}],
 ['unknown freight date duplicate identity and multiple authorization remain diagnosable',async()=>{const c=await client(),a=await document(c,null),b=await document(c);await run(`update fiscal_documents set issue_date='infinity' where id=${q(b)}`);assert.equal((await get(c)).review_count,2);await run(`update fiscal_documents set freight_value=100,issue_date='2026-01-01',access_key=repeat('9',44) where id in(${q(a)},${q(b)})`);assert.equal((await get(c)).diagnostics.duplicate_invoice_identity,2);const d=await document(c);await emission(d);await emission(d);assert.equal((await get(c)).diagnostics.multiple_authorizations,1);}],
 ['tenant and driver access isolation, invalid filters, cancelled service',async()=>{const c=await client(),doc=await document(c);await run(`update fiscal_documents set status='cancelled' where id=${q(doc)}`);assert.equal((await get(c)).forecast_cents,'0');await assert.rejects(()=>run(auth+summary(null,i.otherTenant)),/access_denied/);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+summary(c)),/access_denied/);await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.driverUser)},'operator',true)`);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+summary(c)),/access_denied/);await assert.rejects(()=>get(randomUUID()),/client_not_found/);await assert.rejects(()=>rows(c,0),/invalid_filters/);}]
 ];for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
