// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceProductionRpcDatabase} from './helpers/financeProductionRpcDatabase';
import {financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createFinanceProductionRpcDatabase>>;
const migration=readFileSync('supabase/migrations/20260922213900_payable_account_payment_and_archive.sql','utf8');
beforeAll(async()=>{
 db=await createFinanceProductionRpcDatabase();
 const f=JSON.parse(readFileSync('src/test/fixtures/payableActionsDependencies.json','utf8'));
 await db.exec('set check_function_bodies=off');
 for(const sql of f.tables)await db.exec(sql);
 for(const sql of f.functions)await db.exec(sql);
 for(const sql of f.views)await db.exec(sql);
 await db.exec(`set check_function_bodies=on;
  alter table public.tenants add primary key(id);alter table public.payables add primary key(id);
  create unique index on public.finance_commands(tenant_id,request_id);
  do $$declare r record;begin for r in select table_schema,table_name,column_name,data_type from information_schema.columns
   where table_schema in('public','finance_private') and ((column_name='id' and data_type='uuid') or (column_name='created_at' and data_type='timestamp with time zone')) loop
   execute format('alter table %I.%I alter column %I set default %s',r.table_schema,r.table_name,r.column_name,case when r.column_name='id' then 'gen_random_uuid()' else 'now()' end);
  end loop;end $$;`);
 for(const sql of f.triggers)await db.exec(sql);
 await db.exec(migration);
 await db.exec('alter table public.cost_centers add unique(tenant_id,id)');
 await db.exec(readFileSync('supabase/migrations/20260922214653_finance_movement_cost_center.sql','utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('begin');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:i.operator,role:'authenticated',active_tenant_id:i.tenant})]);
 await db.query('insert into public.tenants(id) values($1),($2)',[i.tenant,i.otherTenant]);
 await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'qa@example.test','{}')",[i.operator]);
 await db.query("insert into public.tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true),($1,$3,'driver',true)",[i.tenant,i.operator,i.driverUser]);
 await db.query("insert into public.bank_accounts(id,tenant_id,active,name,account_type) values($1,$2,true,'Conta QA','checking'),($3,$4,true,'Outra empresa','checking')",[i.account,i.tenant,i.otherAccount,i.otherTenant]);
});
afterEach(async()=>{await db.exec('rollback');});
async function rpc(sql:string,args:unknown[],actor=i.operator){
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,role:'authenticated',active_tenant_id:i.tenant})]);
 await db.exec('savepoint action;set constraints all deferred;set role authenticated');
 try{const r=await db.query<{v:Record<string,unknown>}>(sql,args);await db.exec('set constraints all immediate;reset role;release savepoint action');return r.rows[0].v;}
 catch(e){await db.exec('rollback to savepoint action;release savepoint action');throw e;}
}
async function title(status='approved',amount=100){const id=randomUUID();await db.query("insert into public.payables(id,tenant_id,supplier_name,category,description,amount,status,source,paid_amount,due_date,created_by) values($1,$2,'Fornecedor QA','supplier','Compra QA',$3,$4,'manual',0,'2026-09-01',$5)",[id,i.tenant,amount,status,i.operator]);return id;}
const command=(id:string)=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:id,bank_account_id:i.account,amount_cents:5000,paid_on:'2026-09-01',method:'pix',reason:'Pagamento realizado pelo banco',bank_reference:''});
const pay=(c:ReturnType<typeof command>,actor=i.operator)=>rpc('select public.pay_finance_payable_from_account($1) v',[c],actor);
const portfolio=(visibility='active')=>rpc('select public.get_finance_payable_portfolio($1,$2,1,null) v',[i.tenant,{visibility}]);
async function archiveCommand(ids:string[]){const rows=(await portfolio()).rows as {source_id:string;source_revision:string}[];return {version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Cadastro duplicado identificado',items:ids.map(id=>({payable_id:id,revision:rows.find(r=>r.source_id===id)!.source_revision}))};}
const archive=(c:Awaited<ReturnType<typeof archiveCommand>>)=>rpc('select public.archive_finance_payables($1) v',[c]);

it('records chosen account, payment and movement once and recalculates the title through real triggers',async()=>{
 const id=await title(),c=command(id),result=await pay(c);
 expect(result).toMatchObject({payable_id:id,bank_account_id:i.account,amount_cents:'5000',confirmed:true});
 expect(await pay(c)).toEqual(result);
 expect((await db.query('select (amount*100)::int cents,bank_account_id from payables_payments')).rows).toEqual([{cents:5000,bank_account_id:i.account}]);
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
 expect((await db.query('select status,paid_amount::int paid from payables where id=$1',[id])).rows[0]).toMatchObject({status:'partial',paid:50});
});
it('rolls back the movement when the payment exceeds the title balance',async()=>{
 const id=await title();await expect(pay({...command(id),amount_cents:10001})).rejects.toThrow('finance_payable_overpaid');
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from finance_commands')).rows[0]).toEqual({n:0});
});
it('rejects another company account, driver access and pending titles',async()=>{
 const id=await title();await expect(pay({...command(id),bank_account_id:i.otherAccount})).rejects.toThrow('finance_invalid_account');
 await expect(pay(command(id),i.driverUser)).rejects.toThrow('finance_access_denied');
 const pending=await title('pending');await expect(pay(command(pending))).rejects.toThrow('finance_payable_not_payable');
});
it('excludes unpaid and cancelled titles while keeping their records and audit available',async()=>{
 const first=await title('pending'),second=await title('cancelled'),c=await archiveCommand([first,second]);
 expect(await archive(c)).toMatchObject({confirmed:true});expect(await archive(c)).toMatchObject({confirmed:true});
 expect(await portfolio()).toMatchObject({total_titles:0});
 expect(await portfolio('archived')).toMatchObject({total_titles:2,cancelled_titles:2,nominal_cents:'0'});
 expect((await db.query("select count(*)::int n from finance_events where action='payable_archived'")).rows[0]).toEqual({n:2});
 expect((await db.query('select count(*)::int n from payables')).rows[0]).toEqual({n:2});
});
it('rejects stale selections and rolls the whole exclusion back if one title has a payment',async()=>{
 const first=await title(),second=await title(),stale=await archiveCommand([first]);
 await db.query("update payables set description='Alterado' where id=$1",[first]);
 await expect(archive(stale)).rejects.toThrow('finance_payable_archive_changed');
 await pay(command(second));const c=await archiveCommand([first,second]);
 await expect(archive(c)).rejects.toThrow('finance_payable_archive_has_payments');
 expect((await db.query('select count(*)::int n from finance_private.payable_archives')).rows[0]).toEqual({n:0});
 expect((await db.query('select status from payables where id=$1',[first])).rows[0]).toEqual({status:'pending'});
});
it('preserves operational titles and prevents reactivating a title hidden as excluded',async()=>{
 const id=await title('pending');await db.query("update payables set source_table='payroll_entries',source_id=$2 where id=$1",[id,randomUUID()]);
 await expect(archive(await archiveCommand([id]))).rejects.toThrow('finance_payable_archive_origin_required');
 const simple=await title('pending');await archive(await archiveCommand([simple]));
 await db.exec('savepoint reactivation');
 await expect(db.query("update payables set status='pending' where id=$1",[simple])).rejects.toThrow('finance_archived_payable_immutable');
 await db.exec('rollback to savepoint reactivation');
 expect((await db.query("select has_function_privilege('anon','public.pay_finance_payable_from_account(jsonb)','execute') payment,has_function_privilege('anon','public.archive_finance_payables(jsonb)','execute') archive,has_table_privilege('authenticated','finance_private.payable_archives','insert') direct_write")).rows[0]).toEqual({payment:false,archive:false,direct_write:false});
});
