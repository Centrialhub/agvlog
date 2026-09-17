// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import type {PayableBulkCommand,PayableBulkContext,PayableBulkResult} from '@/lib/financial/payableBulkSettlementContract';

const read=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
let db:PGlite;

beforeAll(async()=>{
  db=await createFinanceLedgerDatabase();
  await db.exec(`
    alter table drivers add column name text default 'Motorista QA';
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
    create table payroll_periods(id uuid primary key,tenant_id uuid,status text default 'approved',period_start date default current_date,closed_by uuid,closed_at timestamptz,notes text,updated_at timestamptz);
    create table employees(id uuid primary key,tenant_id uuid,name text,doc_cpf text,branch text,department text);
    create table payroll_entries(id uuid primary key,tenant_id uuid,payroll_period_id uuid,employee_id uuid,status text,amount_to_pay numeric(14,2),already_paid_amount numeric(14,2),gross_amount numeric(14,2),discount_amount numeric(14,2),created_at timestamptz default now());
    create table payables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,payable_id uuid,amount numeric,
      paid_at timestamptz,bank_account_id uuid,method text,notes text,attachment_url text,bank_transaction_id uuid,created_by uuid);
  `);
  const baseline=read('20260824224152_baseline');
  const recalc=baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\(\)[\s\S]*?\$function\$;/)?.[0];
  const closePayroll=baseline.match(/CREATE OR REPLACE FUNCTION public\.close_payroll_period\([\s\S]*?\$function\$;/)?.[0];
  if(!recalc||!closePayroll)throw new Error('Missing payable/payroll predecessor');
  await db.exec(`${recalc}\n${closePayroll}`);
  await db.exec('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();');
  for(const file of ['20260909212514_finance_delivery_unloading','20260909213959_finance_expense_batches','20260909220020_finance_expense_workspace_queries','20260909233625_finance_audit_queries','20260910000731_finance_payroll_payment_projection','20260910002244_finance_payable_movement_links','20260910003529_finance_payable_link_reversal'])await db.exec(read(file));
  await db.exec(read('20260910182541_finance_movement_correction_foundation'));
  const guards=read('20260910183506_finance_active_movement_financial_guards');
  await db.exec(guards.slice(0,guards.indexOf('create function finance_private.guard_active_financial_movement_reference()')));
  // Model the effective production rule: membership alone is insufficient when
  // another company is active; driver/mixed identities remain denied.
  await db.exec(`create or replace function finance_private.can_access(_tenant uuid) returns boolean
    language sql stable security definer set search_path='' as $$
      select auth.uid() is not null
        and nullif(current_setting('request.active_tenant',true),'')::uuid=_tenant
        and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role in('owner','admin','operator'))
        and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role='driver')
        and not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=auth.uid() and d.active)
    $$;`);
  await db.query("select set_config('request.active_tenant',$1,false)",[i.tenant]);
  await db.exec(read('20260914205842_finance_payable_bulk_settlement'));
},30000);

beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.active_tenant',$1,false)",[i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});

async function movement(amount=50000){
  const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:amount,
    occurred_on:'2026-01-15',description:'Pagamento agrupado',beneficiary_name:'Fornecedor QA',bank_reference:'PIX-LOTE-QA',reason:'Pagamento realizado e conferido'};
  return (await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[payload])).rows[0].v.movement_id;
}
async function payable(amount:number,supplier='Fornecedor QA',tenant=i.tenant,driver:string|null=null){
  return (await db.query<{id:string}>("insert into payables(tenant_id,supplier_name,category,description,amount,status,driver_id) values($1,$2,'supplier','Documento conferido',$3,'approved',$4) returning id",[tenant,supplier,amount,driver])).rows[0].id;
}
const proposal=(ids:string[],amounts:number[])=>ids.map((payable_id,index)=>({payable_id,amount_cents:String(amounts[index])}));
async function preview(movementId:string,items:ReturnType<typeof proposal>,actor=i.operator){
  return (await financeAs<{v:PayableBulkContext}>(db,actor,'select get_finance_payable_bulk_context($1,$2,$3) v',[i.tenant,movementId,items])).rows[0].v;
}
function command(movementId:string,context:PayableBulkContext,items:ReturnType<typeof proposal>):PayableBulkCommand{return {version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_id:movementId,
  bank_account_id:i.account,paid_on:'2026-01-15',expected_revision:context.expected_revision,items,method:'pix',reason:'Baixa agrupada conferida pelo financeiro'};}
async function apply(payload:ReturnType<typeof command>,actor=i.operator){
  return (await financeAs<{v:PayableBulkResult}>(db,actor,'select apply_finance_payable_bulk_movement($1) v',[payload])).rows[0].v;
}

describe('atomic payable bulk settlement',()=>{
  it('allocates one recorded movement to two titles atomically, audits every item and replays exactly once',async()=>{
    const m=await movement(),p=await payable(300),q=await payable(200),items=proposal([p,q],[30000,20000]);
    const context=await preview(m,items);
    expect(context).toMatchObject({tenant_id:i.tenant,eligible:true,total_cents:'50000',movement:{id:m,bank_account_id:i.account,occurred_on:'2026-01-15',remaining_cents:'50000'}});
    const payload=command(m,context,items),result=await apply(payload);
    expect(await apply(payload)).toEqual(result);
    expect(result).toMatchObject({tenant_id:i.tenant,request_id:payload.request_id,movement_id:m,bank_account_id:i.account,paid_on:'2026-01-15',total_cents:'50000',cash_created:false,confirmed:true});
    expect(result.rows).toHaveLength(2);
    expect((await db.query('select status,trunc(paid_amount,2)::text paid_amount from payables order by id')).rows).toEqual(expect.arrayContaining([{status:'paid',paid_amount:'200.00'},{status:'paid',paid_amount:'300.00'}]));
    expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:1}]);
    expect((await db.query('select count(*)::int n from bank_transactions')).rows).toEqual([{n:0}]);
    expect((await db.query("select action,count(*)::int n from finance_events where action like 'payable_bulk%' group by action order by action")).rows).toEqual([
      {action:'payable_bulk_movement_applied',n:2},{action:'payable_bulk_movement_confirmed',n:1},
    ]);
  });

  it('requires the reviewed revision and the explicit account and payment date',async()=>{
    const m=await movement(),p=await payable(300),q=await payable(200),items=proposal([p,q],[30000,20000]),context=await preview(m,items);
    await expect(apply({...command(m,context,items),bank_account_id:i.otherAccount})).rejects.toThrow('finance_payable_bulk_movement_changed');
    await expect(apply({...command(m,context,items),paid_on:'2026-01-16'})).rejects.toThrow('finance_payable_bulk_movement_changed');
    await db.query("update payables set amount=301 where id=$1",[p]);
    await expect(apply(command(m,context,items))).rejects.toThrow('finance_payable_bulk_changed');
    expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:0}]);
  });

  it('rolls back the first item if the final item or its audit chain fails',async()=>{
    const m=await movement(),p=await payable(300),q=await payable(200),items=proposal([p,q],[30000,20000]),context=await preview(m,items);
    await db.exec(`create function fail_bulk_second() returns trigger language plpgsql as $$begin if new.payable_id='${q}'::uuid then raise exception 'qa_second_item_failed';end if;return new;end$$;
      create trigger fail_bulk_second before insert on payables_payments for each row execute function fail_bulk_second();`);
    await expect(apply(command(m,context,items))).rejects.toThrow('qa_second_item_failed');
    expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:0}]);
    expect((await db.query('select count(*)::int n from finance_payable_movement_links')).rows).toEqual([{n:0}]);
    expect((await db.query("select count(*)::int n from finance_commands where action='apply_payable_bulk_movement'")).rows).toEqual([{n:0}]);
    expect((await db.query("select count(*)::int n from finance_events where action like 'payable_bulk%'")).rows).toEqual([{n:0}]);
  });

  it('rolls back every payment and link when the final batch audit cannot be persisted',async()=>{
    const m=await movement(),p=await payable(300),q=await payable(200),items=proposal([p,q],[30000,20000]),context=await preview(m,items);
    await db.exec(`create function fail_bulk_final_audit() returns trigger language plpgsql as $$begin if new.action='payable_bulk_movement_confirmed' then raise exception 'qa_bulk_audit_failed';end if;return new;end$$;
      create trigger fail_bulk_final_audit before insert on finance_events for each row execute function fail_bulk_final_audit();`);
    await expect(apply(command(m,context,items))).rejects.toThrow('qa_bulk_audit_failed');
    expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:0}]);
    expect((await db.query('select count(*)::int n from finance_payable_movement_links')).rows).toEqual([{n:0}]);
    expect((await db.query("select count(*)::int n from finance_commands where action='apply_payable_bulk_movement'")).rows).toEqual([{n:0}]);
    expect((await db.query("select count(*)::int n from finance_events where action like 'payable_bulk%'")).rows).toEqual([{n:0}]);
  });

  it('isolates tenants and the active company and denies driver or mixed identities',async()=>{
    const m=await movement(),p=await payable(300),q=await payable(200),foreign=await payable(1,'Fornecedor QA',i.otherTenant),items=proposal([p,q],[30000,20000]);
    await expect(preview(m,proposal([p,foreign],[100,100]))).rejects.toThrow('finance_payable_not_found');
    await expect(preview(m,items,i.driverUser)).rejects.toThrow('finance_access_denied');
    await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);
    await expect(preview(m,items,i.driverUser)).rejects.toThrow('finance_access_denied');
    await db.query("select set_config('request.active_tenant',$1,false)",[i.otherTenant]);
    await expect(preview(m,items)).rejects.toThrow('finance_access_denied');
  });

  it('rejects mixed beneficiaries and preserves title-specific driver identity',async()=>{
    const m=await movement(),p=await payable(300),other=await payable(200,'Outro fornecedor');
    await expect(preview(m,proposal([p,other],[30000,20000]))).rejects.toThrow('finance_payable_bulk_beneficiary_mismatch');
    const driverTitle=await payable(200,'Fornecedor QA',i.tenant,i.driver);
    await expect(preview(m,proposal([p,driverTitle],[30000,20000]))).rejects.toThrow('finance_payment_driver_mismatch');
    expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:0}]);
  });
});
