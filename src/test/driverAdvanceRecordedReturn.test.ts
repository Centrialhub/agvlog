// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createCashForecastAgendaDatabase} from './helpers/cashForecastAgendaDatabase';
import {financeAs,financeIds as ids} from './helpers/financeLedgerDatabase';

let db:PGlite;
beforeAll(async()=>{
 db=await createCashForecastAgendaDatabase();
 if(!(await db.query<{present:boolean}>("select to_regclass('finance_private.cost_disposition_returns') is not null present")).rows[0].present){await db.exec('revoke all on function finance_private.receipt_movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role');for(const migration of ['20260911072557_finance_unloading_covered_cost_regularization.sql','20260911072723_finance_effective_cost_disposition_readers.sql','20260911074203_finance_unloading_cost_regularization_public_boundary.sql','20260911074603_finance_cost_disposition_recorded_returns.sql'])await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));}
 if(!(await db.query<{present:boolean}>("select to_regprocedure('public.record_finance_cost_disposition_return(jsonb)') is not null present")).rows[0].present)await db.exec(readFileSync('supabase/migrations/20260911080545_finance_cost_disposition_return_public_boundary.sql','utf8'));
 await db.exec('revoke all on function finance_private.movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role');
 await db.exec("alter table drivers add column if not exists name text default 'Motorista QA'");
 await db.exec(readFileSync('supabase/migrations/20260914220500_finance_driver_advance_recorded_returns.sql','utf8'));
},60000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);});
afterEach(async()=>{await db.exec('rollback');});

const command=()=>({version:1,tenant_id:ids.tenant,request_id:randomUUID(),reason:'Devolução real conferida no encerramento da prestação de contas'});
async function movement(direction:'in'|'out',amount:number,driver=ids.driver){return(await financeAs<{value:{movement_id:string}}>(db,ids.operator,'select record_finance_movement($1) value',[{...command(),bank_account_id:ids.account,direction,nature:direction==='out'?'driver_advance':'refund',driver_id:driver,amount_cents:amount,occurred_on:'2026-09-01',description:direction==='out'?'PIX enviado ao motorista':'Devolução recebida do motorista',beneficiary_name:'Motorista QA'}])).rows[0].value.movement_id;}
async function seed(){
 const advance=await movement('out',50000),incoming=await movement('in',5000),batch=randomUUID(),expense=randomUUID();
 await db.query("insert into finance_expense_batches(id,tenant_id,context,description,created_by) values($1,$2,'office','Prestação de contas QA',$3)",[batch,ids.tenant,ids.operator]);
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) values($1,$2,$3,'fuel','Gastos conferidos',45000,'2026-09-01','Fornecedores da viagem','Recibos conferidos',$4)",[expense,ids.tenant,batch,ids.operator]);
 await db.query('insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values($1,$2,$3,45000,$4)',[ids.tenant,expense,advance,ids.operator]);
 return{advance,incoming};
}

it('closes R$500 as R$450 expenses plus a real R$50 return without changing either movement',async()=>{
 const s=await seed();const before=(await db.query('select to_jsonb(m) value from finance_movements m order by created_at,id')).rows;
 const preview=(await financeAs<{value:{revision:string;eligible:boolean;can_execute:boolean;effects:{open_before_cents:string;open_after_cents:string;cash_created:boolean}}}>(db,ids.operator,'select preview_finance_driver_advance_return($1,$2,$3,$4) value',[ids.tenant,s.advance,s.incoming,'5000'])).rows[0].value;
 expect(preview).toMatchObject({eligible:true,can_execute:true,effects:{open_before_cents:'5000',open_after_cents:'0',cash_created:false}});
 const payload={...command(),advance_movement_id:s.advance,incoming_movement_id:s.incoming,amount_cents:'5000',expected_revision:preview.revision};
 const result=(await financeAs<{value:unknown}>(db,ids.operator,'select record_finance_driver_advance_return($1) value',[payload])).rows[0].value;
 expect((await financeAs<{value:unknown}>(db,ids.operator,'select record_finance_driver_advance_return($1) value',[payload])).rows[0].value).toEqual(result);
 const positions=(await financeAs<{value:{rows:Array<{movement_id:string;allocated_cents:string;returned_cents:string;open_cents:string;verified:boolean}>}}>(db,ids.operator,'select get_finance_driver_advance_positions($1,1) value',[ids.tenant])).rows[0].value;
 expect(positions.rows.find((position)=>position.movement_id===s.advance)).toMatchObject({allocated_cents:'45000',returned_cents:'5000',open_cents:'0',verified:true});
 expect((await db.query<{used:string}>('select finance_private.movement_used_cents($1,$2)::text used',[ids.tenant,s.advance])).rows[0].used).toBe('50000');
 expect((await db.query<{used:string}>('select finance_private.receipt_movement_used_cents($1,$2)::text used',[ids.tenant,s.incoming])).rows[0].used).toBe('5000');
 expect((await db.query('select to_jsonb(m) value from finance_movements m order by created_at,id')).rows).toEqual(before);
 expect((await db.query<{count:number}>("select count(*)::int count from finance_events where action='driver_advance_return_recorded'")).rows[0].count).toBe(1);
});

it('rejects cross-driver, cross-tenant and stale/capacity reuse',async()=>{
 const s=await seed(),otherDriver=randomUUID();await db.query("insert into drivers(id,tenant_id,user_id,active,name) values($1,$2,null,true,'Outro motorista')",[otherDriver,ids.tenant]);const wrong=await movement('in',5000,otherDriver);
 expect((await financeAs<{value:{eligible:boolean;blockers:string[]}}>(db,ids.operator,'select preview_finance_driver_advance_return($1,$2,$3,$4) value',[ids.tenant,s.advance,wrong,'5000'])).rows[0].value).toMatchObject({eligible:false,blockers:expect.arrayContaining(['finance_driver_advance_return_movement_incompatible'])});
 const preview=(await financeAs<{value:{revision:string}}>(db,ids.operator,'select preview_finance_driver_advance_return($1,$2,$3,$4) value',[ids.tenant,s.advance,s.incoming,'5000'])).rows[0].value;
 await financeAs(db,ids.operator,'select record_finance_driver_advance_return($1)',[{...command(),advance_movement_id:s.advance,incoming_movement_id:s.incoming,amount_cents:'5000',expected_revision:preview.revision}]);
 await db.exec('savepoint over_return');await expect(financeAs(db,ids.operator,'select record_finance_driver_advance_return($1)',[{...command(),advance_movement_id:s.advance,incoming_movement_id:wrong,amount_cents:'1',expected_revision:preview.revision}])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint over_return');
 await expect(financeAs(db,ids.operator,'select get_finance_driver_advance_positions($1,1)',[ids.otherTenant])).rejects.toMatchObject({code:'42501'});
 await expect(financeAs(db,ids.driverUser,'select get_finance_driver_advance_positions($1,1)',[ids.tenant])).rejects.toMatchObject({code:'42501'});
});

it('lists only tenant-scoped positions and eligible incoming movements with stable pagination',async()=>{
 const s=await seed();const positions=(await financeAs<{value:{total:number;rows:Array<{movement_id:string;open_cents:string}>}}>(db,ids.operator,'select get_finance_driver_advance_positions($1,1) value',[ids.tenant])).rows[0].value;
 expect(positions).toMatchObject({total:1,rows:[{movement_id:s.advance,open_cents:'5000'}]});
 const options=(await financeAs<{value:{total:number;revision:string;rows:Array<{id:string;available_cents:string}>}}>(db,ids.operator,"select get_finance_driver_advance_return_options($1,$2,'Devolução',1,null) value",[ids.tenant,s.advance])).rows[0].value;
 expect(options).toMatchObject({total:1,rows:[{id:s.incoming,available_cents:'5000'}]});
 await expect(financeAs(db,ids.operator,"select get_finance_driver_advance_return_options($1,$2,'',2,null)",[ids.tenant,s.advance])).rejects.toMatchObject({code:'22023'});
});
