// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {parseFinancialContext} from '../lib/financial/receivableCommands';
import {fiscalQueueSchema} from '../lib/financial/fiscalQueueContract';
let db:PGlite;
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`create table clients(id uuid primary key,tenant_id uuid,company_name text,tax_id text,active boolean);
 create table cte_documents(id uuid primary key,tenant_id uuid,client_id uuid,freight_value numeric,net_value numeric,fiscal_document_ids uuid[],payer_cnpj text);
 create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,cte_document_id uuid,fiscal_document_id uuid,description text,amount numeric,status text,received_amount numeric default 0,received_at timestamptz,created_by uuid,updated_at timestamptz,updated_by uuid,invoice_number text,client_invoice_id uuid,closing_report_id uuid);
 create table receivables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,receivable_id uuid,amount numeric,bank_account_id uuid,bank_transaction_id uuid,received_at timestamptz default now(),method text default 'pix',notes text,attachment_url text);
 create table receivable_payment_reversals(id uuid primary key,tenant_id uuid,payment_id uuid,receivable_id uuid,amount numeric,bank_transaction_id uuid,created_at timestamptz,reason text);
 create table bank_transactions(id uuid primary key,tenant_id uuid,bank_account_id uuid,amount numeric,transaction_type text);
 create table client_invoices(id uuid primary key,tenant_id uuid,receivable_id uuid,total_amount numeric,client_id uuid,status text,sent_at timestamptz);
 create table closing_reports(id uuid primary key,tenant_id uuid,receivable_id uuid,client_invoice_id uuid,total_amount numeric,received_amount numeric,open_amount numeric,status text,payment_status text,expected_payment_date date);
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select false$$;
 create table fiscal_documents(id uuid primary key,tenant_id uuid,client_id uuid,freight_value numeric);
 create table nfse_documents(id uuid primary key,tenant_id uuid,cliente_id uuid,pagador_cnpj text,cliente_cnpj text,
 valor_servicos numeric,valor_liquido numeric,valor_total numeric,iss_retido boolean,valor_iss numeric,outras_retencoes numeric,
 valor_pis numeric,valor_cofins numeric,valor_inss numeric,valor_ir numeric,valor_csll numeric,fiscal_document_ids uuid[],is_preview boolean);
 create table hub_fiscal_emissions(id uuid primary key,tenant_id uuid,doc_type text,environment text,status text,dispatch_state text,
 hub_document_id text,id_integracao text,emitter_cnpj text,access_key text,authorization_protocol text,number text,series text,
 provider_document_version bigint,provider_effect_id text,provider_occurred_at timestamptz,request_payload jsonb,
 cte_document_id uuid,fiscal_document_id uuid,nfse_document_id uuid,message text);`);
 await db.exec(readFileSync('supabase/migrations/20260910004550_finance_fiscal_observation_queue.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910005509_finance_fiscal_receivable_basis.sql','utf8'));
 const financial=readFileSync('supabase/migrations/20260830183929_audit_receivable_payments_and_reversals.sql','utf8');
 const guard=financial.match(/create function public\._guard_receivable_ledger\(\)[\s\S]*?\$fn\$;/)?.[0];
 if(!guard)throw new Error('Missing real receivable ledger guard');await db.exec(guard);
 for(const name of ['_recalc_receivable_received','_receivable_financial_snapshot','_lock_receivable_financial_graph']){
  const definition=financial.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$fn\\$;`))?.[0];
  if(!definition)throw new Error(`Missing real ${name}`);await db.exec(definition);
 }
 await db.exec('create trigger ledger_guard before insert or update or delete on receivables for each row execute function _guard_receivable_ledger();');
 await db.exec(readFileSync('supabase/migrations/20260910010034_finance_fiscal_receivable_projection.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910011121_finance_fiscal_cancellation_credits.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910012152_finance_receivable_fiscal_context.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910012756_finance_fiscal_queue_worker.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function emission(status='authorized',environment='production',dispatch='recorded'){
 const id=randomUUID();await db.query('insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state) values($1,$2,$3,$4,$5,$6)',[id,i.tenant,'cte',environment,status,dispatch]);return id;
}
async function readyCte(accessKey='1'.repeat(44)){
 const payer=randomUUID(),source=randomUUID(),id=randomUUID();
 await db.query("insert into clients values($1,$2,'Cliente fiscal',null,true)",[payer,i.tenant]);
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,990)',[source,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[id,i.tenant,source,accessKey,'2'.repeat(15)]);
 return {id,payer,source};
}
async function latest(id:string){return (await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[id])).rows[0].id;}
async function process(observation:string){return (await financeAs<{result:{status:string;issue:string|null;receivable_id:string}}>(db,i.operator,'select process_finance_fiscal_observation($1,$2) result',[i.tenant,observation])).rows[0].result;}
async function worker(limit=50){
 await db.query("select set_config('request.jwt.claim.sub','',false)");
 return (await db.query<{result:{handled:number;deferred:number;failed:number;busy:boolean}}>('select finance_private.run_fiscal_queue($1) result',[limit])).rows[0].result;
}
describe('durable fiscal observations for financial projection',()=>{
 it('lists tenant totals and pages independently of the displayed page and denies drivers',async()=>{
  for(let index=1;index<=32;index++)await readyCte(String(index).padStart(44,'0'));
  const read=async(status:string,page:number)=>fiscalQueueSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_fiscal_queue($1,$2,$3) result',[i.tenant,status,page])).rows[0].result);
  const first=await read('pending',1),second=await read('pending',2);
  expect(first).toMatchObject({total:32,counts:{pending:32,review:0,applied:0,superseded:0},scheduler_active:false});
  expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(2);
  expect(new Set([...first.rows,...second.rows].map(row=>row.observation_id)).size).toBe(32);
  expect((await read('review',1)).total).toBe(0);
  await expect(financeAs(db,i.driverUser,'select list_finance_fiscal_queue($1,$2,$3)',[i.tenant,'',1])).rejects.toThrow('finance_access_denied');
  await expect(financeAs(db,i.operator,'select list_finance_fiscal_queue($1,$2,$3)',[i.otherTenant,'',1])).rejects.toThrow('finance_access_denied');
 });
 it('automatically drains bounded batches, preserves system provenance and skips applied jobs',async()=>{
  await readyCte();await readyCte('3'.repeat(44));
  expect(await worker(1)).toEqual({handled:1,deferred:0,failed:0,busy:false});
  expect((await db.query('select * from receivables')).rows).toHaveLength(1);
  expect(await worker(1)).toMatchObject({handled:1,failed:0});
  expect(await worker()).toMatchObject({handled:0,failed:0});
  expect((await db.query('select * from receivables')).rows).toHaveLength(2);
  expect((await db.query<{actor_id:string|null}>('select actor_id from finance_fiscal_projection_events')).rows.every(row=>row.actor_id===null)).toBe(true);
  await expect(financeAs(db,i.operator,'select finance_private.run_fiscal_queue(50)')).rejects.toThrow('permission denied');
  await expect(financeAs(db,i.driverUser,'select finance_private.run_fiscal_queue(50)')).rejects.toThrow('permission denied');
 });
 it('isolates failed jobs, waits before retry and escalates repeated exceptions without partial titles',async()=>{
  const broken=await readyCte();await readyCte('3'.repeat(44));
  await db.exec(`create function fail_financial_fixture() returns trigger language plpgsql as $$begin
   if new.cte_document_id='${broken.source}'::uuid then raise exception 'fixture failure' using errcode='23514';end if;return new;end;$$;
   create trigger fixture_failure before insert on receivables for each row execute function fail_financial_fixture();`);
  expect(await worker()).toMatchObject({handled:1,failed:1});
  expect((await db.query('select * from receivables')).rows).toHaveLength(1);
  expect(await worker()).toMatchObject({handled:0,failed:0});
  for(let attempt=2;attempt<=5;attempt++){
   await db.exec("update finance_fiscal_projection_jobs set available_at=clock_timestamp()-interval '1 second' where status='pending'");
   expect(await worker()).toMatchObject({handled:0,failed:1});
  }
  expect((await db.query('select status,automatic_failures,last_error_code from finance_fiscal_projection_jobs where automatic_failures>0')).rows).toEqual([{status:'review',automatic_failures:5,last_error_code:'23514'}]);
  expect((await db.query("select * from finance_fiscal_projection_events where action='automatic_projection_failure'")).rows).toHaveLength(5);
  expect((await db.query('select * from finance_fiscal_receivable_origins')).rows).toHaveLength(1);
  expect(await worker()).toMatchObject({handled:0,failed:0});
  await db.exec('drop trigger fixture_failure on receivables');
  expect(await process(await latest(broken.id))).toMatchObject({status:'applied'});
  expect((await db.query('select * from receivables')).rows).toHaveLength(2);
  expect((await db.query("select * from finance_fiscal_projection_events where action='automatic_projection_failure'")).rows).toHaveLength(5);
  expect((await db.query<{actor_id:string}>('select actor_id from finance_fiscal_projection_events where observation_id=$1 and action=$2',[await latest(broken.id),'applied'])).rows[0].actor_id).toBe(i.operator);
  expect(await worker()).toMatchObject({handled:0,failed:0});
 });
 it('changes the receipt context immediately when authorization is lost, before queued processing',async()=>{
  const {id}=await readyCte(),first=await process(await latest(id));
  const context=async()=>parseFinancialContext((await db.query<{result:unknown}>("select _receivable_financial_snapshot($1,$2)-'evidence' result",[i.tenant,first.receivable_id])).rows[0].result,i.tenant,i.operator,first.receivable_id);
  const authorized=await context();expect(authorized.can_receive).toBe(true);expect(authorized.fiscal_block_reason).toBeNull();
  await db.query("update hub_fiscal_emissions set status='cancel_processing' where id=$1",[id]);
  const pending=await context();expect(pending.can_receive).toBe(false);expect(pending.fiscal_block_reason).toBe('fiscal_authorization_unavailable');expect(pending.revision).not.toBe(authorized.revision);
  await process(await latest(id));expect((await context()).fiscal_block_reason).toBe('fiscal_origin_suspended');
  await db.query("update hub_fiscal_emissions set status='cancel_rejected' where id=$1",[id]);
  expect((await context()).can_receive).toBe(false);
  await process(await latest(id));expect((await context()).can_receive).toBe(true);
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  await process(await latest(id));expect(await context()).toMatchObject({can_receive:false,fiscal_block_reason:'fiscal_origin_cancelled',open_cents:0});
 });
 it('converts a valid registered receipt into one credit without changing its bank evidence',async()=>{
  const {id,payer}=await readyCte(),first=await process(await latest(id)),bank=randomUUID();
  await db.query("insert into bank_transactions values($1,$2,$3,200,'credit')",[bank,i.tenant,i.account]);
  await db.query('insert into receivables_payments(tenant_id,receivable_id,amount,bank_account_id,bank_transaction_id) values($1,$2,200,$3,$4)',[i.tenant,first.receivable_id,i.account,bank]);
  await db.query("update receivables set received_amount=200,status='partial' where id=$1",[first.receivable_id]);
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  const observation=await latest(id),result=await process(observation);
  expect(result).toMatchObject({status:'applied',issue:null});expect(await process(observation)).toEqual(result);
  expect((await db.query<{payer_id:string;amount_cents:number}>('select payer_id,amount_cents from finance_customer_credits')).rows).toEqual([{payer_id:payer,amount_cents:20000}]);
  expect((await db.query('select * from bank_transactions')).rows).toHaveLength(1);
  expect((await db.query('select * from receivables_payments')).rows).toHaveLength(1);
  expect((await db.query('select * from receivable_payment_reversals')).rows).toHaveLength(0);
  // The public context endpoint removes internal evidence before returning this contract.
  const snapshot=(await db.query<{result:unknown}>("select _receivable_financial_snapshot($1,$2)-'evidence' result",[i.tenant,first.receivable_id])).rows[0].result;
  const context=parseFinancialContext(snapshot,i.tenant,i.operator,first.receivable_id);
  expect(context).toMatchObject({status:'cancelled',received_cents:0,open_cents:0,requires_reconciliation:false,can_receive:false,can_reverse:false});
  expect(context.payments[0].credit_id).toBeTruthy();expect(context.payments[0].reversed_at).toBeNull();
  expect((await financeAs(db,i.driverUser,'select * from finance_customer_credits')).rows).toHaveLength(0);
 });
 it.each([0,200])('keeps an inverse-linked billing group in review with %s received',async amount=>{
  const {id,payer}=await readyCte(),first=await process(await latest(id));
  if(amount){
   const bank=randomUUID();
   await db.query("insert into bank_transactions values($1,$2,$3,$4,'credit')",[bank,i.tenant,i.account,amount]);
   await db.query('insert into receivables_payments(tenant_id,receivable_id,amount,bank_account_id,bank_transaction_id) values($1,$2,$3,$4,$5)',[i.tenant,first.receivable_id,amount,i.account,bank]);
   await db.query("update receivables set received_amount=$2,status='partial' where id=$1",[first.receivable_id,amount]);
  }
  await db.query("insert into client_invoices(id,tenant_id,receivable_id,total_amount,client_id,status) values($1,$2,$3,1000,$4,'generated')",[randomUUID(),i.tenant,first.receivable_id,payer]);
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  expect(await process(await latest(id))).toMatchObject({status:'review',issue:'cancelled_document_in_billing_group'});
  expect((await db.query('select * from finance_customer_credits')).rows).toHaveLength(0);
  expect((await db.query<{status:string}>('select status from receivables')).rows[0].status).toBe(amount?'partial':'pending');
 });
 it('creates an authorized title exactly once and cancels an unpaid title without generating cash',async()=>{
  const {id,payer}=await readyCte(),observation=await latest(id),first=await process(observation);
  expect(first).toMatchObject({status:'applied',issue:null});expect(await process(observation)).toEqual(first);
  expect((await db.query<{client_id:string;amount:string;status:string}>('select client_id,amount,status from receivables')).rows).toEqual([{client_id:payer,amount:'1000.0000000000000000',status:'pending'}]);
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  expect(await process(await latest(id))).toMatchObject({status:'applied',receivable_id:first.receivable_id});
  expect((await db.query<{status:string}>('select status from receivables')).rows[0].status).toBe('cancelled');
  expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
  expect((await db.query('select * from finance_fiscal_receivable_origins')).rows).toHaveLength(1);
 });
 it('blocks a receipt immediately on cancellation request, then preserves receipts for credit review on confirmed cancellation',async()=>{
  const {id}=await readyCte(),first=await process(await latest(id));
  await db.query('insert into receivables_payments(tenant_id,receivable_id,amount) values($1,$2,200)',[i.tenant,first.receivable_id]);
  await db.query("update receivables set received_amount=200,status='partial' where id=$1",[first.receivable_id]);
  await db.query("update hub_fiscal_emissions set status='cancel_processing' where id=$1",[id]);
  await db.exec('savepoint receipt_attempt');
  await expect(db.query('insert into receivables_payments(tenant_id,receivable_id,amount) values($1,$2,100)',[i.tenant,first.receivable_id])).rejects.toThrow('financial_fiscal_source_not_collectible');
  await db.exec('rollback to savepoint receipt_attempt');
  await process(await latest(id));
  await db.query("update hub_fiscal_emissions set status='cancel_rejected' where id=$1",[id]);
  expect(await process(await latest(id))).toMatchObject({status:'applied'});
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  expect(await process(await latest(id))).toMatchObject({status:'review',issue:'financial_receipt_evidence_mismatch'});
  expect((await db.query<{state:string}>('select state from finance_fiscal_receivable_origins')).rows[0].state).toBe('credit_pending');
  expect((await db.query('select * from receivables_payments')).rows).toHaveLength(1);
  expect((await db.query('select * from receivable_payment_reversals')).rows).toHaveLength(0);
 });
 it('supersedes old authorization and refuses to create a second title for an existing legacy link',async()=>{
  const {id,source}=await readyCte(),observation=await latest(id);
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
  expect(await process(observation)).toMatchObject({status:'superseded'});
  expect((await db.query('select * from receivables')).rows).toHaveLength(0);
  await db.query("update hub_fiscal_emissions set status='authorized',provider_document_version=2 where id=$1",[id]);
  await db.query("insert into receivables(tenant_id,cte_document_id,amount,status) values($1,$2,1000,'pending')",[i.tenant,source]);
  expect(await process(await latest(id))).toMatchObject({status:'review',issue:'existing_receivable_requires_adoption'});
  expect((await db.query('select * from receivables')).rows).toHaveLength(1);
  await expect(financeAs(db,i.driverUser,'select process_finance_fiscal_observation($1,$2)',[i.tenant,await latest(id)])).rejects.toThrow('finance_access_denied');
  await db.query("update hub_fiscal_emissions set status='cancel_processing' where id=$1",[id]);
  await db.exec('savepoint legacy_receipt');
  const legacy=(await db.query<{id:string}>('select id from receivables')).rows[0].id;
  await expect(db.query('insert into receivables_payments(tenant_id,receivable_id,amount) values($1,$2,100)',[i.tenant,legacy])).rejects.toThrow('financial_fiscal_source_not_collectible');
  await db.exec('rollback to savepoint legacy_receipt');
 });
 it('rejects fractional cents, negatives and nonfinite monetary source values',async()=>{
  const rows=(await db.query<{value:string|null}>(`select finance_private.fiscal_cents(v)::text value from (values
   ('1000.000'::jsonb),('0.001'::jsonb),('-1'::jsonb),('"NaN"'::jsonb),('null'::jsonb)) values_to_check(v)`)).rows;
  expect(rows.map(row=>row.value)).toEqual(['100000',null,null,null,null]);
 });
 it('uses the explicit payer document rather than assigning an NFSe to a different operational customer',async()=>{
  const customer=randomUUID(),payer=randomUUID(),source=randomUUID(),id=randomUUID();
  await db.query("insert into clients values($1,$2,'Cliente da operação','11111111000111',true),($3,$2,'Pagador','12345678000190',true)",[customer,i.tenant,payer]);
  await db.query('insert into nfse_documents(id,tenant_id,cliente_id,pagador_cnpj,valor_servicos,valor_liquido,valor_total,iss_retido,valor_iss,outras_retencoes,valor_pis,valor_cofins,valor_inss,valor_ir,valor_csll,is_preview) values($1,$2,$3,$4,1000,950,1000,true,50,0,0,0,0,0,0,false)',[source,i.tenant,customer,'12.345.678/0001-90']);
  await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,nfse_document_id,number,authorization_protocol,hub_document_id) values($1,$2,'nfse','production','authorized','recorded',$3,'123','protocolo','hub-nfse-123')",[id,i.tenant,source]);
  const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1',[id])).rows[0].id;
  const read=async()=>(await financeAs<{result:Record<string,unknown>}>(db,i.operator,'select get_finance_fiscal_receivable_basis($1,$2) result',[i.tenant,observation])).rows[0].result;
  expect(await read()).toMatchObject({ready:true,customer_id:customer,payer_id:payer,amount_basis:'document_net',amount_cents:'95000',gross_cents:'100000',withheld_cents:'5000',issues:[]});
  const projected=await process(observation);expect(projected.status).toBe('applied');
  expect((await db.query<{client_id:string;amount:string}>('select client_id,amount from receivables where id=$1',[projected.receivable_id])).rows[0]).toMatchObject({client_id:payer,amount:'950.0000000000000000'});
  await db.query("insert into clients values($1,$2,'Duplicado','12345678000190',true)",[randomUUID(),i.tenant]);
  expect(await read()).toMatchObject({ready:false,payer_id:null,issues:['payer_document_ambiguous']});
  await db.query('update nfse_documents set valor_liquido=949.99 where id=$1',[source]);
  await db.query("update hub_fiscal_emissions set message='Reavaliar origem' where id=$1",[id]);
  const changed=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[id])).rows[0].id;
  expect((await financeAs<{result:{ready:boolean;issues:string[]}}>(db,i.operator,'select get_finance_fiscal_receivable_basis($1,$2) result',[i.tenant,changed])).rows[0].result).toMatchObject({ready:false,issues:expect.arrayContaining(['nfse_net_amount_conflict'])});
  await expect(financeAs(db,i.driverUser,'select get_finance_fiscal_receivable_basis($1,$2)',[i.tenant,observation])).rejects.toThrow('finance_access_denied');
 });
 it('uses CT-e freight, not the draft net calculation, and rejects missing authorization evidence',async()=>{
  const payer=randomUUID(),source=randomUUID(),id=randomUUID();
  await db.query("insert into clients values($1,$2,'Pagador',null,true)",[payer,i.tenant]);
  await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,990)',[source,i.tenant,payer]);
  await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5)",[id,i.tenant,source,'1'.repeat(44),'2'.repeat(15)]);
  let observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1',[id])).rows[0].id;
  expect((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_fiscal_receivable_basis($1,$2) result',[i.tenant,observation])).rows[0].result).toMatchObject({ready:true,amount_basis:'freight',amount_cents:'100000',payer_id:payer});
  await db.query('update hub_fiscal_emissions set authorization_protocol=null where id=$1',[id]);
  observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[id])).rows[0].id;
  expect((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_fiscal_receivable_basis($1,$2) result',[i.tenant,observation])).rows[0].result).toMatchObject({ready:false,issues:['authorization_evidence_missing']});
 });
 it('ignores drafts, homologation and uncertain observations; repeated metadata updates do not duplicate jobs',async()=>{
  await emission('draft');await emission('authorized','homologation');await emission('authorized','production','uncertain');
  expect((await db.query('select * from finance_fiscal_observations')).rows).toHaveLength(0);
  const id=await emission();await db.query("update hub_fiscal_emissions set message='Consulta repetida' where id=$1",[id]);
  expect((await db.query('select * from finance_fiscal_observations')).rows).toHaveLength(1);
  expect((await db.query<{status:string}>('select status from finance_fiscal_projection_jobs')).rows).toEqual([{status:'pending'}]);
  expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
 });
 it('preserves authorization, cancellation request, rejected cancellation and confirmed cancellation as distinct facts',async()=>{
  const id=await emission();
  for(const status of ['cancel_processing','cancel_rejected','cancelled'])await db.query('update hub_fiscal_emissions set status=$1 where id=$2',[status,id]);
  const states=(await db.query<{status:string}>("select snapshot->>'status' status from finance_fiscal_observations order by observed_order")).rows.map(r=>r.status);
  expect(states).toEqual(['authorized','cancel_processing','cancel_rejected','cancelled']);
  expect((await db.query('select * from finance_fiscal_projection_jobs')).rows).toHaveLength(4);
  await expect(financeAs(db,i.driverUser,'select * from finance_fiscal_projection_jobs')).resolves.toMatchObject({rows:[]});
  expect((await financeAs(db,i.operator,'select * from finance_fiscal_observations')).rows).toHaveLength(4);
 });
 it('captures NFSe withholding and payer context and retains missing source identity for review',async()=>{
  const source=randomUUID(),id=randomUUID();
  await db.query('insert into nfse_documents(id,tenant_id,cliente_id,pagador_cnpj,valor_servicos,valor_liquido,valor_total,iss_retido,valor_iss,is_preview) values($1,$2,$3,$4,1000,950,1000,true,50,false)',[source,i.tenant,randomUUID(),'12345678000190']);
  await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,nfse_document_id) values($1,$2,'nfse','production','authorized','recorded',$3)",[id,i.tenant,source]);
  const snapshot=(await db.query<{snapshot:{nfse:unknown}}>('select snapshot from finance_fiscal_observations where emission_id=$1',[id])).rows[0].snapshot;
  expect(snapshot.nfse).toMatchObject({service_amount:1000,net_amount:950,iss_withheld:true,iss_amount:50,payer_cnpj:'12345678000190'});
  const missing=await emission();
  expect((await db.query<{snapshot:{cte:null}}>('select snapshot from finance_fiscal_observations where emission_id=$1',[missing])).rows[0].snapshot.cte).toBeNull();
 });
});
