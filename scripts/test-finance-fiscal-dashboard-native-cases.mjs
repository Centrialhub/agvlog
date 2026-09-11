import assert from 'node:assert/strict';
import {fiscalDashboardSchema} from '../src/lib/financial/fiscalDashboardContract.ts';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runFiscalDashboardNative({query,contested,literal:q,createRoles=false}){
 const database='finance_fiscal_dashboard_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
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
 const payer=randomUUID();await run(`insert into clients(id,tenant_id,company_name,active) values(${q(payer)},${q(i.tenant)},'Fiscal QA',true)`);
 const rpc=(tenant=i.tenant)=>`select get_finance_fiscal_dashboard_summary(${q(tenant)},null,null,null,'all')`;
 const get=async()=>fiscalDashboardSchema.parse(JSON.parse(await run(auth+rpc())));
 const worker=id=>run(`${auth}select process_finance_fiscal_observation(${q(i.tenant)},(select id from finance_fiscal_observations where emission_id=${q(id)} order by observed_order desc limit 1))`);
 const tests=[
 ['1005 CTe authorizations processed by actual worker use freight and complete totals',async()=>{
 await run(`${identity}do $$declare source uuid;emission uuid;observation uuid;begin for n in 1..1005 loop source:=gen_random_uuid();emission:=gen_random_uuid();insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values(source,${q(i.tenant)},${q(payer)},1000,990);insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values(emission,${q(i.tenant)},'cte','production','authorized','recorded',source,lpad(n::text,44,'0'),repeat('2',15),n::text);select id into observation from finance_fiscal_observations where emission_id=emission;perform process_finance_fiscal_observation(${q(i.tenant)},observation);end loop;end$$`);
 const r=await get();assert.equal(r.total_count,1005);assert.equal(r.active_count,1005);assert.equal(r.net_cents,'100500000');assert.equal(r.gross_cents,'100500000');assert.equal(r.withheld_cents,'0');}],
 ['NFS-e withholding keeps gross separate from receivable net',async()=>{const source=randomUUID(),emission=randomUUID(),client=randomUUID();await run(`insert into clients(id,tenant_id,company_name,tax_id,active) values(${q(client)},${q(i.tenant)},'NFS-e','12345678000190',true);insert into nfse_documents(id,tenant_id,cliente_id,pagador_cnpj,valor_servicos,valor_liquido,valor_total,iss_retido,valor_iss,outras_retencoes,valor_pis,valor_cofins,valor_inss,valor_ir,valor_csll,is_preview) values(${q(source)},${q(i.tenant)},${q(client)},'12345678000190',1000,950,1000,true,50,0,0,0,0,0,0,false);insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,nfse_document_id,number,authorization_protocol,hub_document_id) values(${q(emission)},${q(i.tenant)},'nfse','production','authorized','recorded',${q(source)},'123','protocolo','hub-nfse-123')`);await worker(emission);const r=await get();assert.equal(r.net_cents,'100595000');assert.equal(r.gross_cents,'100600000');assert.equal(r.withheld_cents,'5000');}],
 ['cancellation invalidates before worker then removes active amount',async()=>{const id=await run("select id from hub_fiscal_emissions where doc_type='cte' and number='1'");await run(`update hub_fiscal_emissions set status='cancelled' where id=${q(id)}`);let r=await get();assert.equal(r.invalid_count,1);assert.equal(r.net_cents,null);assert.equal(r.pending_jobs,1);await worker(id);r=await get();assert.equal(r.active_count,1005);assert.equal(r.cancelled_count,1);assert.equal(r.net_cents,'100495000');}],
 ['access key change while authorized invalidates then enters review without active credit',async()=>{const id=await run("select id from hub_fiscal_emissions where doc_type='cte' and number='2'");await run(`update hub_fiscal_emissions set access_key=repeat('9',44) where id=${q(id)}`);assert.equal((await get()).invalid_count,1);await worker(id);const r=await get();assert.equal(r.active_count,1004);assert.equal(r.review_count,1);assert.equal(r.net_cents,'100395000');assert.equal(r.pending_jobs,1);}],
 ['changed payer invalidates current active origin',async()=>{const client=randomUUID();await run(`insert into clients(id,tenant_id,company_name,active) values(${q(client)},${q(i.tenant)},'Outro',true);update receivables set client_id=${q(client)} where id=(select o.receivable_id from finance_fiscal_receivable_origins o join hub_fiscal_emissions e on e.id=o.emission_id where e.doc_type='cte' and e.number='3')`);const r=await get();assert.equal(r.invalid_count,1);assert.equal(r.totals_valid,false);assert.equal(r.net_cents,null);}],
 ['driver mixed role foreign tenant and invalid dates rejected',async()=>{await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+rpc()),/access_denied/);await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.driverUser)},'operator',true)`);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+rpc()),/access_denied/);await assert.rejects(()=>run(auth+rpc(i.otherTenant)),/access_denied/);await assert.rejects(()=>run(`${auth}select get_finance_fiscal_dashboard_summary(${q(i.tenant)},'2026-02-01','2026-01-01')`),/invalid_filters/);}],
 ['EXPLAIN full body executes every projected origin',async()=>{const source=readFileSync('supabase/migrations/20260910152711_finance_fiscal_dashboard_summary.sql','utf8');let body=source.slice(source.indexOf('with selected as materialized'),source.indexOf(' into result from totals t;'));for(const [key,value] of [['_tenant',q(i.tenant)+'::uuid'],['_from','null::date'],['_to','null::date'],['_client','null::uuid'],['_kind',"'all'::text"]])body=body.replace(new RegExp('\\b'+key+'\\b','g'),value);const plan=await run(identity+'explain (analyze,buffers,format text) '+body+' from totals t');assert.match(plan,/rows=1006/);assert.match(plan,/Execution Time/);console.log('FULL BODY PLAN\n'+plan);}]
 ];for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
