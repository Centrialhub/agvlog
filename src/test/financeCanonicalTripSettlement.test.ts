// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;const trip=randomUUID();
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await db.exec(type[0]);
 for(const table of ['clients','cost_centers','dispatch_trips','dispatch_stops','dispatch_stop_documents','dispatch_trip_loads','loads','fiscal_documents','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','receivables','payables','payables_payments','employees','employee_contracts','employee_advances','employee_incident_actions','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec(`alter table drivers add column name text default 'Motorista QA';alter table fiscal_documents add column current_delivery_attempt_id uuid;
 alter table payroll_entries add unique(payroll_period_id,employee_id);create view finance_private.active_payable_payments as select * from payables_payments;
 create schema control_tower_private;create function control_tower_private.settlement_route_km(uuid,uuid) returns numeric language sql as $$select null::numeric$$;
 create function public._delivery_trip_financial_documents(uuid,uuid) returns setof public.fiscal_documents language sql as $$select * from public.fiscal_documents where false$$;
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;`);
 for(const name of ['_log_settlement_event','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item']){const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!fn)throw new Error(name);await db.exec(fn);}
 const builder=readFileSync('supabase/migrations/20260831114316_separate_planned_and_remaining_route_distance.sql','utf8').match(/CREATE OR REPLACE FUNCTION public\._build_driver_settlement\([\s\S]*?\$function\$\s*;/)?.[0];if(!builder)throw new Error('builder');await db.exec(builder);
 for(const name of ['20260909212514_finance_delivery_unloading','20260909213959_finance_expense_batches','20260910000731_finance_payroll_payment_projection','20260910132406_finance_payroll_reimbursement_source_dedup','20260910133352_finance_payroll_lifecycle_serialization','20260910134948_finance_canonical_trip_cost_settlement'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
 await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status,actual_end_at) values($1,$2,$3,'completed','2026-01-20T12:00:00Z')",[trip,i.tenant,i.driver]);
},30000);
beforeEach(async()=>{await db.exec(`begin;set request.jwt.claim.sub='${i.operator}'`);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
async function build(){return (await db.query<{id:string}>('select _build_driver_settlement($1,$2) id',[i.tenant,trip])).rows[0].id;}
async function batch(context='trip'){
 const movement=(await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) result',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:context==='trip'?'driver_advance':'payment',driver_id:context==='trip'?i.driver:undefined,amount_cents:9000,occurred_on:'2026-01-20',description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado antes dos recibos'}])).rows[0].result.movement_id;
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),context,...(context==='trip'?{trip_id:trip}:{}),description:'Gastos conferidos',reason:'Conferência no retorno',items:[{id:randomUUID(),category:'fuel',amount_cents:10000,description:'Combustível',occurred_on:'2026-01-20',supplier_name:'Posto QA',payee_type:context==='trip'?'driver':'supplier',no_receipt_reason:'Recibo solicitado',allocations:[{movement_id:movement,amount_cents:4000}]},{id:randomUUID(),category:'food',amount_cents:5000,description:'Alimentação',occurred_on:'2026-01-20',supplier_name:'Restaurante QA',payee_type:context==='trip'?'driver':'supplier',no_receipt_reason:'Recibo solicitado',allocations:[{movement_id:movement,amount_cents:5000}]}]};
 await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[payload]);return payload;
}
async function summary(id:string){return (await db.query<{approved_expenses_total:string;expenses_total:string;route_result:string;driver_reimbursement_total:string;driver_payable_amount:string;needs_recalculation:boolean;snapshot_json:Record<string,unknown>}>('select * from driver_settlements where id=$1',[id])).rows[0];}
it('preserves the supported builder version while marking the canonical-cost contract',async()=>{
 const current=(await db.query<{definition:string}>("select pg_get_functiondef('public._build_driver_settlement(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
 expect(current).toContain("'calculation_version', 'driver_settlement_v3_attempts_finance_costs'");

 const source=readFileSync('supabase/migrations/20260831114316_separate_planned_and_remaining_route_distance.sql','utf8');
 const builder=source.match(/CREATE OR REPLACE FUNCTION public\._build_driver_settlement\([\s\S]*?\$function\$\s*;/)?.[0];
 if(!builder)throw new Error('builder');
 await db.exec(builder.replace("'calculation_version', 'driver_settlement_v3_attempts'","'calculation_version', 'driver_settlement_v2'"));

 const migration=readFileSync('supabase/migrations/20260910134948_finance_canonical_trip_cost_settlement.sql','utf8');
 const builderPatch=migration.match(/do \$patch\$declare body text;needle text;begin[\s\S]*?end \$patch\$;/)?.[0];
 if(!builderPatch)throw new Error('builder patch');
 await db.exec(builderPatch);

 const compatible=(await db.query<{definition:string}>("select pg_get_functiondef('public._build_driver_settlement(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
 expect(compatible).toContain("'calculation_version', 'driver_settlement_v2_finance_costs'");
 expect(compatible.match(/v_canonical_cost\s+numeric\s*:=\s*0/g)).toHaveLength(1);
 expect(compatible.match(/finance_private\.canonical_trip_costs\(_tenant_id,\s*_dispatch_trip_id\)/g)?.length).toBeGreaterThanOrEqual(3);
});
it('includes integral canonical costs and sources without creating another driver reimbursement or payable',async()=>{
 const id=await build();await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount,metadata) values($1,$2,'adjustment','credit',200,'{}')",[i.tenant,id]);const payload=await batch();expect((await summary(id)).needs_recalculation).toBe(true);
 await build();const s=await summary(id);expect([s.approved_expenses_total,s.expenses_total,s.route_result,s.driver_reimbursement_total,s.driver_payable_amount].map(Number)).toEqual([150,150,-150,0,200]);
 const rows=(await db.query<{source_id:string;metadata:{payable_id:string|null;settlement_credit_created:boolean;reimbursable:boolean;allocation_total_cents:number}}>("select source_id,metadata from driver_settlement_items where source_table='finance_expense_items' order by amount desc")).rows;
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({source_id:payload.items[0].id,metadata:{reimbursable:false,settlement_credit_created:false,allocation_total_cents:4000}});expect(rows[0].metadata.payable_id).toBeTruthy();expect(rows[1].metadata.payable_id).toBeNull();
 expect(s.snapshot_json.canonical_expenses).toHaveLength(2);expect((await db.query('select * from payables')).rows).toHaveLength(1);expect((await db.query('select * from driver_expenses')).rows).toHaveLength(0);
});
it('rebuild and request replay never accumulate derived costs',async()=>{
 const id=await build(),payload=await batch();await build();await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[payload]);await build();await build();
 expect(Number((await summary(id)).expenses_total)).toBe(150);expect((await db.query("select * from driver_settlement_items where source_table='finance_expense_items'")).rows).toHaveLength(2);expect((await db.query('select * from payables')).rows).toHaveLength(1);
});
it('adds canonical costs alongside legacy expenses while preserving only the legacy reimbursement',async()=>{
 await db.query("insert into driver_expenses(tenant_id,driver_id,dispatch_trip_id,category,amount,expense_at,approval_status,reimbursable) values($1,$2,$3,'food',25,'2026-01-20T12:00:00Z','approved',true)",[i.tenant,i.driver,trip]);
 const id=await build();await batch();await build();const s=await summary(id);expect([s.expenses_total,s.driver_reimbursement_total,s.driver_payable_amount].map(Number)).toEqual([175,25,25]);
 expect((await db.query("select * from driver_settlement_items where source_table='driver_expenses'")).rows).toHaveLength(1);
});
it.each(['approved','paid','closed'])('new costs mark %s settlement stale without replacing its protected snapshot',async status=>{
 const id=await build();await db.query('update driver_settlements set status=$1 where id=$2',[status,id]);const before=await summary(id);await batch();const after=await summary(id);
 expect(after.needs_recalculation).toBe(true);expect(after.snapshot_json).toEqual(before.snapshot_json);expect(after.approved_expenses_total).toBe(before.approved_expenses_total);
 await db.exec('savepoint protected');await expect(build()).rejects.toThrow('settlement_locked');await db.exec('rollback to savepoint protected');
});
it('does not assign office costs or trip batches to a manual settlement by driver',async()=>{
 const id=await build(),manual=randomUUID();await db.query("insert into driver_settlements(id,tenant_id,driver_id,is_manual,status,needs_recalculation) values($1,$2,$3,true,'pending_review',false)",[manual,i.tenant,i.driver]);
 await batch('office');expect((await summary(id)).needs_recalculation).toBe(false);await batch();expect((await summary(manual)).needs_recalculation).toBe(false);
});
it('payroll credits only settlement remuneration while the canonical complement remains its original single title',async()=>{
 const id=await build();await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount,metadata) values($1,$2,'adjustment','credit',200,'{}')",[i.tenant,id]);await batch();await build();await db.query("update driver_settlements set status='approved' where id=$1",[id]);
 const title=(await db.query('select * from payables')).rows;await db.query("insert into employees(tenant_id,driver_id,name) values($1,$2,'Motorista QA')",[i.tenant,i.driver]);
 await financeAs(db,i.operator,"select generate_payroll_period($1,'2026-01-01','2026-01-31')",[i.tenant]);
 expect((await db.query("select item_type,amount::numeric(14,2)::text amount from payroll_entry_items where nature='credit'")).rows).toEqual([{item_type:'driver_settlement',amount:'200.00'}]);
 expect((await db.query('select * from payables')).rows).toEqual(title);
});
it.each(['credit','payable','allocation','source'])('does not let forged canonical %s bypass reimbursement source review',async invalid=>{
 const id=await build();await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount,metadata) values($1,$2,'adjustment','credit',200,'{}')",[i.tenant,id]);await batch();await build();
 const changes={credit:"metadata=jsonb_set(metadata,'{settlement_credit_created}','true')",payable:"metadata=metadata-'payable_id'",allocation:"metadata=jsonb_set(metadata,'{allocation_total_cents}','1')",source:"source_table='arbitrary_source'"};
 await db.exec(`update driver_settlement_items set ${changes[invalid as keyof typeof changes]} where source_table='finance_expense_items'`);await db.query("update driver_settlements set status='approved' where id=$1",[id]);await db.query("insert into employees(tenant_id,driver_id,name) values($1,$2,'Motorista QA')",[i.tenant,i.driver]);
 await expect(financeAs(db,i.operator,"select generate_payroll_period($1,'2026-01-01','2026-01-31')",[i.tenant])).rejects.toThrow('finance_payroll_reimbursement_source_review');
});
