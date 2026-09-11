// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {payableMovementOptionsSchema,payablePaymentHistorySchema} from '../lib/financial/payableMovementContract';
import {recordedCostsSchema} from '@/lib/financial/recordedCostsContract';
let db:PGlite;
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`alter table drivers add column name text default 'Motorista QA';
 create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
 create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
 create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text);
 create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text);
 create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid,client_id uuid);
 create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
 create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,description text,amount numeric,status text,due_date date,created_by uuid);
 create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,supplier_name text,supplier_id uuid,
  category text,description text,amount numeric,due_date date,competence_date date,status text,driver_id uuid,dispatch_trip_id uuid,
  document_number text,receipt_url text,created_by uuid,source_table text,source_id uuid,cost_center text,
  paid_amount numeric default 0,paid_at timestamptz,updated_at timestamptz);
 create table bank_transactions(id uuid primary key);
 create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);
 create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);
 create table payroll_periods(id uuid primary key,tenant_id uuid,status text default 'approved',period_start date default current_date,closed_by uuid,closed_at timestamptz,notes text,updated_at timestamptz);
 create table employees(id uuid primary key,tenant_id uuid,name text,doc_cpf text,branch text,department text);
 create table payroll_entries(id uuid primary key,tenant_id uuid,payroll_period_id uuid,employee_id uuid,status text,amount_to_pay numeric(14,2),already_paid_amount numeric(14,2),gross_amount numeric(14,2),discount_amount numeric(14,2),created_at timestamptz default now());
 create table payables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,payable_id uuid,amount numeric,
  paid_at timestamptz,bank_account_id uuid,method text,notes text,attachment_url text,bank_transaction_id uuid,created_by uuid);
 `);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 await db.exec('create function public.is_tenant_admin(uuid) returns boolean language sql as $$select true$$;');
 for(const name of ['_recalc_payable_paid','reverse_payable_payment','close_payroll_period']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  if(!body)throw new Error(`Missing ${name}`);await db.exec(body);
 }
 await db.exec('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();grant execute on function reverse_payable_payment(uuid) to authenticated;');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function manualFixture(){
 await db.exec("alter table clients add column is_supplier boolean default false;alter table payables add column notes text,add column source text;");
 await db.exec("create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);");
 await db.exec(readFileSync('supabase/migrations/20260910120756_finance_manual_expense_recording.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910125034_finance_manual_expense_cost_center.sql','utf8'));
}
function manualCommand(movement?:string){return {version:1,tenant_id:i.tenant,request_id:randomUUID(),supplier_name:'Papelaria QA',category:'other',description:'Material para a sede',amount_cents:30000,reason:'Despesa conferida pelo financeiro',...(movement?{movement_id:movement,method:'pix'}:{})};}
async function manual(p:Record<string,unknown>,actor=i.operator){return (await financeAs<{result:{payable_id:string;cash_created:false}}>(db,actor,'select record_finance_manual_expense($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;}
it('validates the manual expense cost center and preserves its identity and name on replay',async()=>{
 await manualFixture();const center=randomUUID(),other=randomUUID();
 await db.query("insert into cost_centers values($1,$3,'Sede',true),($2,$4,'Outra empresa',true)",[center,other,i.tenant,i.otherTenant]);
 await expect(manual({...manualCommand(),cost_center_id:other})).rejects.toThrow('finance_invalid_cost_center');
 const p={...manualCommand(),cost_center_id:center},result=await manual(p);
 expect((await db.query('select cost_center from payables where id=$1',[result.payable_id])).rows).toEqual([{cost_center:'Sede'}]);
 await db.query("update cost_centers set name='Renomeado',active=false where id=$1",[center]);
 expect(await manual(p)).toEqual(result);
 await expect(manual({...manualCommand(),cost_center_id:center})).rejects.toThrow('finance_invalid_cost_center');
 expect((await db.query<{after_data:Record<string,unknown>}>("select after_data from finance_events where entity_id=$1 and action='manual_expense_recorded'",[result.payable_id])).rows[0].after_data).toMatchObject({cost_center_id:center,cost_center_name:'Sede'});
 expect((await db.query('select * from payables')).rows).toHaveLength(1);
});
it('consolidates batches and manual expenses without adding their cash or complementary payables again',async()=>{
 await manualFixture();await db.exec(readFileSync('supabase/migrations/20260910125357_finance_recorded_costs.sql','utf8'));
 const center=randomUUID(),batch=randomUUID(),item=randomUUID();
 await db.query("insert into cost_centers values($1,$2,'Sede',true)",[center,i.tenant]);
 const manualResult=await manual({...manualCommand(await movement()),cost_center_id:center,competence_date:'2026-01-01'});
 const complement=randomUUID();await db.query("insert into payables(id,tenant_id,amount,status) values($1,$2,200,'pending')",[complement,i.tenant]);
 await db.query("insert into finance_expense_batches(id,tenant_id,context,description,created_by) values($1,$2,'office','Gastos da sede',$3)",[batch,i.tenant,i.operator]);
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,cost_center_id,no_receipt_reason,payable_id,created_by) values($1,$2,$3,'food','Lanches',20000,'2026-01-01','Lanchonete',$4,'Comprovante solicitado',$5,$6)",[item,i.tenant,batch,center,complement,i.operator]);
 const read=async(filters:Record<string,unknown>={},actor=i.operator)=>recordedCostsSchema.parse((await financeAs<{result:unknown}>(db,actor,'select list_finance_recorded_costs($1,$2::jsonb) result',[i.tenant,JSON.stringify(filters)])).rows[0].result);
 expect(await read()).toMatchObject({total:2,total_cents:'50000',needs_review_count:0,cost_centers:[{cost_center_id:center,amount_cents:'50000'}]});
 expect(await read({category:'food'})).toMatchObject({total:1,total_cents:'20000'});
 expect(await read({search:'%'})).toMatchObject({total:0,total_cents:'0'});
 await db.query("update payables set amount=350 where id=$1",[manualResult.payable_id]);
 expect(await read()).toMatchObject({total_cents:'50000',needs_review_count:1});
 await db.query("update payables set status='cancelled' where id=$1",[manualResult.payable_id]);
 expect(await read()).toMatchObject({total:2,total_cents:'20000',cancelled_count:1});
 await expect(read({},i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(financeAs(db,i.operator,'select list_finance_recorded_costs($1)',[i.otherTenant])).rejects.toThrow('finance_access_denied');
 // All-filter totals must include records beyond the first page.
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) select gen_random_uuid(),$1,$2,'other','Item adicional',100,'2026-01-01','Fornecedor','Comprovante solicitado',$3 from generate_series(1,31)",[i.tenant,batch,i.operator]);
 expect(await read()).toMatchObject({total:33,total_cents:'23100'});expect((await read()).rows).toHaveLength(30);expect((await read({page:2})).rows).toHaveLength(3);
});
it('includes approved payroll remuneration once and separates advances and unclassified trip credits',async()=>{
 await manualFixture();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8'),start=baseline.indexOf('CREATE TABLE public.payroll_entry_items ('),end=baseline.indexOf('\n);',start);
 await db.exec(baseline.slice(start,end+3));
 await db.exec(readFileSync('supabase/migrations/20260910125357_finance_recorded_costs.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910130032_finance_payroll_recorded_costs.sql','utf8'));
 const period=randomUUID(),employee=randomUUID(),entry=randomUUID();
 await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Funcionário QA')",[employee,i.tenant]);
 await db.query("insert into payroll_periods(id,tenant_id,status,period_start) values($1,$2,'approved','2026-01-01')",[period,i.tenant]);
 await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,amount_to_pay,gross_amount,already_paid_amount,discount_amount) values($1,$2,$3,$4,'approved',2750,3750,1000,0)",[entry,i.tenant,period,employee]);
 for(const [type,nature,amount] of [['base_salary','credit',3000],['commission','credit',50],['driver_advance','already_paid',1000],['driver_expense_reimbursement','credit',200],['driver_settlement','credit',500]]){
  await db.query("insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount,source_metadata,locked,created_at) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$5,$7,'{}',true,now())",[i.tenant,period,entry,employee,type,nature,amount]);
 }
 await db.query("insert into payables(tenant_id,amount,status,source_table,source_id,category) values($1,2750,'approved','payroll_entries',$2,'payroll')",[i.tenant,entry]);
 await movement();
 const read=async()=>recordedCostsSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_recorded_costs($1) result',[i.tenant])).rows[0].result);
 const result=await read();expect(result).toMatchObject({total:2,total_cents:'305000',payroll_unclassified_count:2,payroll_unclassified_cents:'70000'});
 expect(result.rows.every(r=>r.source==='payroll_item'&&r.date_basis==='payroll_period')).toBe(true);
 await db.query("update payroll_periods set status='draft' where id=$1",[period]);
 expect(await read()).toMatchObject({total:0,total_cents:'0',payroll_unclassified_count:0});
});
it('creates and pays a manual obligation from existing cash exactly once',async()=>{
 await manualFixture();const m=await movement(),p=manualCommand(m),r=await manual(p);expect(await manual(p)).toEqual(r);expect(r.cash_created).toBe(false);
 expect((await db.query('select (paid_amount*100)::bigint::text paid_cents,status from payables where id=$1',[r.payable_id])).rows).toEqual([{paid_cents:'30000',status:'paid'}]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);
 await expect(manual({...p,amount_cents:30100})).rejects.toThrow('finance_request_conflict');
});
it('rolls back the manual obligation if the existing movement has insufficient capacity',async()=>{
 await manualFixture();const m=await movement();await expect(manual({...manualCommand(m),amount_cents:60000})).rejects.toThrow('finance_movement_overallocated');
 expect((await db.query('select * from payables')).rows).toHaveLength(0);expect((await db.query('select * from payables_payments')).rows).toHaveLength(0);
});
it('creates an unpaid obligation without cash and denies driver submission',async()=>{
 await manualFixture();const p=manualCommand(),r=await manual(p);expect(await manual(p)).toEqual(r);
 expect((await db.query('select status from payables where id=$1',[r.payable_id])).rows).toEqual([{status:'pending'}]);expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
 await expect(manual(manualCommand(),i.driverUser)).rejects.toThrow('finance_access_denied');
});
it('retains the original manual expense receipt and denies missing or foreign evidence',async()=>{
 await manualFixture();const path=i.tenant+'/payable-payments/receipt.pdf';
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"mimetype\":\"application/pdf\",\"size\":100}')",[path]);
 const p={...manualCommand(),receipt_path:path};await manual(p);expect((await db.query('select * from finance_manual_expense_evidence')).rows).toHaveLength(1);
 await db.exec('savepoint receipt_delete');await expect(db.query('delete from storage.objects where name=$1',[path])).rejects.toThrow('finance_receipt_retention_required');await db.exec('rollback to savepoint receipt_delete');
 await expect(manual({...manualCommand(),receipt_path:i.otherTenant+'/payable-payments/x.pdf'})).rejects.toThrow('finance_invalid_receipt_scope');
});
it('retires legacy payable writers without changing evidence or disabling their replacements',async()=>{
 await manualFixture();const m=await movement(),first=await manual(manualCommand(m));
 const snapshot=async()=>(await db.query("select jsonb_build_object('payables',(select jsonb_agg(to_jsonb(p) order by id) from payables p),'payments',(select jsonb_agg(to_jsonb(p) order by id) from payables_payments p),'movements',(select jsonb_agg(to_jsonb(p) order by id) from finance_movements p),'events',(select jsonb_agg(to_jsonb(p) order by id) from finance_events p)) state")).rows;
 const before=await snapshot(),baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const name of ['create_manual_expense','register_payable_payment']){
  const definition=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!definition)throw new Error('Missing '+name);await db.exec(definition);
 }
 await db.exec('grant select,insert,update,delete on payables_payments to authenticated;');
 await db.exec(readFileSync('supabase/migrations/20260910121937_finance_retire_legacy_payable_writers.sql','utf8'));expect(await snapshot()).toEqual(before);
 expect((await db.query("select has_table_privilege('authenticated','payables_payments','select') readable,has_table_privilege('authenticated','payables_payments','insert') insertable,has_table_privilege('authenticated','payables_payments','update') updatable,has_table_privilege('authenticated','payables_payments','delete') deletable")).rows[0]).toEqual({readable:true,insertable:false,updatable:false,deletable:false});
 const signatures=['public.create_manual_expense(jsonb)','public.register_payable_payment(uuid,numeric,timestamp with time zone,uuid,text,text,text)','public.reverse_payable_payment(uuid)'];
 for(const signature of signatures)expect((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows[0]).toEqual({allowed:false});
 await expect(financeAs(db,i.operator,'select create_manual_expense($1::jsonb)',[JSON.stringify({tenant_id:i.tenant})])).rejects.toThrow('permission denied');
 await db.exec('savepoint retired_owner');await expect(db.query('select reverse_payable_payment($1)',[randomUUID()])).rejects.toThrow('finance_legacy_writer_retired');await db.exec('rollback to savepoint retired_owner');
 const next=await manual(manualCommand());expect(next.payable_id).not.toBe(first.payable_id);expect(next.cash_created).toBe(false);
 const link=(await db.query<{id:string}>('select id from finance_payable_movement_links where payable_id=$1',[first.payable_id])).rows[0].id;
 await financeAs(db,i.operator,'select reverse_finance_payable_link($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:link,reason:'Correção auditada após migração'})]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
 await db.exec('set constraints all immediate;savepoint bypass');
 await expect(db.query("insert into payables_payments(tenant_id,payable_id,amount,paid_at,bank_account_id,method,created_by) values($1,$2,1,now(),$3,'pix',$4)",[i.tenant,next.payable_id,i.account,i.operator])).rejects.toThrow('finance_payment_requires_recorded_movement');await db.exec('rollback to savepoint bypass');
 await db.exec('savepoint erase_history');await expect(db.query('delete from payables_payments where payable_id=$1',[first.payable_id])).rejects.toThrow(/finance_immutable_record|finance_linked_payment_requires_audited_correction/);await db.exec('rollback to savepoint erase_history');
});
async function movement(){
 const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,
 occurred_on:'2026-01-01',description:'Envio agrupado',beneficiary_name:'Fornecedor QA',reason:'Registro do envio efetuado'};
 return (await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) result',[JSON.stringify(p)])).rows[0].result.movement_id;
}
async function payable(amount=500){return (await db.query<{id:string}>("insert into payables(tenant_id,supplier_name,category,amount,status) values($1,'Fornecedor QA','other',$2,'approved') returning id",[i.tenant,amount])).rows[0].id;}
function command(m:string,p:string,cents=30000){return {version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_id:m,payable_id:p,amount_cents:cents,method:'pix',reason:'Vínculo conferido pelo financeiro'};}
async function apply(p:ReturnType<typeof command>){return (await financeAs<{result:{payment_id:string;link_id:string}}>(db,i.operator,'select apply_finance_payable_movement($1) result',[JSON.stringify(p)])).rows[0].result;}

it('links a historical settlement payment without creating money and shares its capacity with payables',async()=>{
 await db.exec('create table driver_settlements(id uuid primary key,tenant_id uuid,driver_id uuid);create table driver_settlement_payments(id uuid primary key,tenant_id uuid,settlement_id uuid,amount numeric(14,2),paid_at timestamptz);');
 await db.exec(readFileSync('supabase/migrations/20260910130540_finance_settlement_movement_links.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910131149_finance_settlement_link_audit.sql','utf8'));
 const settlement=randomUUID(),payment=randomUUID();
 await db.query('insert into driver_settlements values($1,$2,$3)',[settlement,i.tenant,i.driver]);
 await db.query("insert into driver_settlement_payments values($1,$2,$3,300,'2026-01-01T12:00:00Z')",[payment,i.tenant,settlement]);
 const mov={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',driver_id:i.driver,amount_cents:50000,occurred_on:'2026-01-01',description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado e conferido'};
 const m=(await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1::jsonb) result',[JSON.stringify(mov)])).rows[0].result.movement_id;
 const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:payment,movement_id:m,reason:'Pagamento anterior conferido com a movimentação'};
 const link=async(payload=p,actor=i.operator)=>(await financeAs<{result:Record<string,unknown>}>(db,actor,'select link_finance_settlement_payment($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
 await expect(link(p,i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(link({...p,movement_id:await movement()})).rejects.toThrow('finance_settlement_movement_mismatch');
 const result=await link();expect(await link()).toEqual(result);expect(result).toMatchObject({payment_id:payment,movement_id:m,amount_cents:30000,cash_created:false});
 const audit=(await financeAs<{result:{total:number;rows:Array<{manual_intervention:boolean;actor_id:string;reason:string}>}}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) result',[i.tenant,JSON.stringify({manual_only:true,action:'settlement_payment_linked'})])).rows[0].result;
 expect(audit).toMatchObject({total:1,rows:[{manual_intervention:true,actor_id:i.operator,reason:p.reason}]});
 await expect(link({...p,request_id:randomUUID()})).rejects.toThrow('finance_settlement_payment_already_linked');
 expect((await db.query('select * from driver_settlement_payments')).rows).toHaveLength(1);
 const title=await payable(200);await apply(command(m,title,20000));
 await expect(apply(command(m,await payable(1),100))).rejects.toThrow('finance_movement_overallocated');
 expect((await db.query<{used:string}>('select finance_private.movement_used_cents($1,$2)::text used',[i.tenant,m])).rows[0].used).toBe('50000');
 await db.exec('savepoint protected_payment');await expect(db.query('update driver_settlement_payments set amount=1 where id=$1',[payment])).rejects.toThrow('finance_linked_payment_requires_audited_correction');await db.exec('rollback to savepoint protected_payment');
 expect((await financeAs(db,i.driverUser,'select * from finance_settlement_movement_links')).rows).toHaveLength(0);
});
describe('payable payments reuse recorded cash',()=>{
 it('reverses attribution without erasing money or payment history, and supports a corrected allocation',async()=>{
  const m=await movement(),p=await payable(200),link=await apply(command(m,p,20000));
  const correction={version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:link.link_id,reason:'Título selecionado incorretamente'};
  async function reverse(){return (await financeAs<{result:unknown}>(db,i.operator,'select reverse_finance_payable_link($1) result',[JSON.stringify(correction)])).rows[0].result;}
  const first=await reverse();expect(await reverse()).toEqual(first);
  expect((await db.query<{paid_amount:string;status:string}>('select paid_amount,status from payables where id=$1',[p])).rows[0]).toMatchObject({paid_amount:'0',status:'approved'});
  expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
  expect((await db.query('select * from payables_payments')).rows).toHaveLength(1);
  expect((await db.query('select * from finance_payable_link_reversals')).rows).toHaveLength(1);
  const history=(await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payable_payment_history($1,$2) result',[i.tenant,p])).rows[0].result;
  // This fixture deliberately stops at 003529. The modern origin discriminator
  // is validated with the real 43833 reader in legacyPayableAssociationOptions.
  const historicalSchema=payablePaymentHistorySchema.extend({rows:payablePaymentHistorySchema.shape.rows.element.omit({link_origin:true}).array()});
  expect(historicalSchema.parse(history)).toMatchObject({total:1,rows:[{id:link.payment_id,link_id:link.link_id,amount:200,reversal:{actor_id:i.operator,actor_name:'Financeiro QA',reason:correction.reason}}]});
  const audit=(await financeAs<{result:{manual_count:number;rows:{action:string}[]}}>(db,i.operator,'select list_finance_audit_events($1,$2) result',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].result;
  expect(audit.manual_count).toBe(2);expect(audit.rows.map(row=>row.action)).toContain('payable_link_reversed');
  await apply(command(m,p,20000));
  expect((await db.query('select * from payables_payments')).rows).toHaveLength(2);
  expect((await db.query('select * from finance_private.active_payable_payments')).rows).toHaveLength(1);
  const options=(await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payable_movements($1,$2) result',[i.tenant,p])).rows[0].result;
  expect(payableMovementOptionsSchema.parse(options)).toMatchObject({remaining_cents:'0',rows:[{remaining_cents:'30000'}]});
  await expect(financeAs(db,i.driverUser,'select reverse_finance_payable_link($1)',[JSON.stringify({...correction,request_id:randomUUID()})])).rejects.toThrow('finance_access_denied');
 });
 it('protects a closed payroll and updates its payment projection after an allowed reversal',async()=>{
  const m=await movement(),p=await payable(200),period=randomUUID(),entry=randomUUID();
  await db.query("insert into payroll_periods(id,tenant_id,status) values($1,$2,'closed')",[period,i.tenant]);
  await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,amount_to_pay,already_paid_amount,gross_amount,discount_amount) values($1,$2,$3,$4,'approved',200,0,200,0)",[entry,i.tenant,period,randomUUID()]);
  await db.query("update payables set source_table='payroll_entries',source_id=$1,category='payroll' where id=$2",[entry,p]);
  const link=await apply(command(m,p,20000)),correction={version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:link.link_id,reason:'Corrigir a atribuição do pagamento'};
  await expect(financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[JSON.stringify(correction)])).rejects.toThrow('finance_payroll_closed_requires_reopening');
  await db.exec("update payroll_periods set status='approved'");
  await financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[JSON.stringify(correction)]);
  const projection=(await financeAs<{result:{rows:{payment_summary:{remaining_amount:string;status:string}}[]}}>(db,i.operator,'select get_finance_payroll_entries($1,$2) result',[i.tenant,period])).rows[0].result;
  expect(projection.rows[0].payment_summary).toMatchObject({remaining_amount:'200.00',status:'unpaid'});
 });
 it('allocates one send across titles, retries without duplication and leaves bank evidence untouched',async()=>{
  const m=await movement(),p=await payable(300),q=await payable(200),c=command(m,p);
  const first=await apply(c);expect(await apply(c)).toEqual(first);
  const candidates=(await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payable_movements($1,$2) result',[i.tenant,q])).rows[0].result;
  expect(payableMovementOptionsSchema.parse(candidates)).toMatchObject({can_apply:true,remaining_cents:'20000',total:1,rows:[{id:m,remaining_cents:'20000',amount_cents:'50000'}]});
  await apply(command(m,q,20000));
  expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
  expect((await db.query('select * from payables_payments')).rows).toHaveLength(2);
  expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);
  expect((await db.query<{status:string}>('select status from payables')).rows.map(r=>r.status)).toEqual(['paid','paid']);
  await expect(apply({...c,amount_cents:29900})).rejects.toThrow('finance_request_conflict');
 });
 it('shares capacity with expense batches and removes exhausted sends from the existing picker',async()=>{
  const m=await movement(),p=await payable();
  const batch={version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'office',description:'Compra para sede',reason:'Conferência de comprovante',items:[{
   id:randomUUID(),category:'food',description:'Lanches sede',amount_cents:20000,occurred_on:'2026-01-01',supplier_name:'Comércio',
   no_receipt_reason:'Recibo aguardando conferência',allocations:[{movement_id:m,amount_cents:20000}]}]};
  await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[JSON.stringify(batch)]);
  await expect(apply(command(m,p,35000))).rejects.toThrow('finance_movement_overallocated');
  expect((await db.query('select * from payables_payments')).rows).toHaveLength(0);
  await apply(command(m,p,30000));
  const options=await financeAs<{result:{rows:unknown[]}}>(db,i.operator,"select get_finance_expense_options($1,'movements') result",[i.tenant]);
  expect(options.rows[0].result.rows).toHaveLength(0);
  await expect(financeAs(db,i.operator,'select record_finance_expense_batch($1)',[JSON.stringify({...batch,request_id:randomUUID(),items:batch.items.map(row=>({...row,id:randomUUID()}))})])).rejects.toThrow('finance_movement_overallocated');
 });
 it('rejects overpayment and driver access, and preserves payment evidence against legacy deletion',async()=>{
  const m=await movement(),p=await payable(200);
  await expect(apply(command(m,p,20001))).rejects.toThrow('finance_payable_overpaid');
  await expect(financeAs(db,i.driverUser,'select apply_finance_payable_movement($1)',[JSON.stringify(command(m,p,20000))])).rejects.toThrow('finance_access_denied');
  const result=await apply(command(m,p,20000));
  await expect(financeAs(db,i.operator,'select reverse_payable_payment($1)',[result.payment_id])).rejects.toThrow('finance_linked_payment_requires_audited_correction');
  expect((await db.query('select * from payables_payments')).rows).toHaveLength(1);
  expect((await db.query('select * from finance_payable_movement_links')).rows).toHaveLength(1);
 });
 it('enforces the remaining title balance for legacy inserts as well as the new command',async()=>{
  const m=await movement(),p=await payable(200);
  await apply(command(m,p,15000));
  await db.exec('savepoint legacy_insert');
  await expect(db.query('insert into payables_payments(tenant_id,payable_id,amount,bank_account_id) values($1,$2,50.01,$3)',[i.tenant,p,i.account])).rejects.toThrow('finance_payable_overpaid');
  await db.exec('rollback to savepoint legacy_insert');
  await db.query('insert into payables_payments(tenant_id,payable_id,amount,bank_account_id) values($1,$2,50,$3)',[i.tenant,p,i.account]);
  expect((await db.query<{paid_amount:string}>('select paid_amount from payables where id=$1',[p])).rows[0].paid_amount).toBe('200.0000000000000000');
 });
});
