import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runTripCostBuilderNative({query,contested,session,finish,waitForMarker,literal:q,createRoles=false}){
 const database='finance_trip_cost_builder_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','cost_centers','dispatch_trips','dispatch_stops','dispatch_stop_documents','dispatch_trip_loads','loads','fiscal_documents','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','receivables','payables','payables_payments','employees','employee_contracts','employee_advances','employee_incident_actions','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);await run(`alter table ${table} add primary key(id)`);
 }
 await run(`alter table drivers add column name text default 'Motorista QA';alter table fiscal_documents add column current_delivery_attempt_id uuid;
 alter table payroll_entries add unique(payroll_period_id,employee_id);create view finance_private.active_payable_payments as select * from payables_payments;
 create schema control_tower_private;create function control_tower_private.settlement_route_km(uuid,uuid) returns numeric language sql as $$select null::numeric$$;
 create function public._delivery_trip_financial_documents(uuid,uuid) returns setof public.fiscal_documents language sql as $$select * from public.fiscal_documents where false$$;
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;`);
 for(const name of ['_log_settlement_event','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];assert.ok(fn,name);await run(fn);
 }
 const builder=readFileSync('supabase/migrations/20260831114316_separate_planned_and_remaining_route_distance.sql','utf8').match(/CREATE OR REPLACE FUNCTION public\._build_driver_settlement\([\s\S]*?\$function\$\s*;/)?.[0];assert.ok(builder);await run(builder);
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260910000731_finance_payroll_payment_projection.sql','20260910132406_finance_payroll_reimbursement_source_dedup.sql','20260910133352_finance_payroll_lifecycle_serialization.sql','20260910134948_finance_canonical_trip_cost_settlement.sql']){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+sql+'commit;');console.log('Trip cost builder candidate '+file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const build=f=>`${identity}select _build_driver_settlement(${q(i.tenant)},${q(f.trip)})`;
 const record=f=>`${auth}select record_finance_expense_batch(${q(JSON.stringify(f.payload))}::jsonb)`;
 async function fixture(){
  const trip=randomUUID();await run(`insert into dispatch_trips(id,tenant_id,driver_id,status,actual_end_at) values(${q(trip)},${q(i.tenant)},${q(i.driver)},'completed','2026-01-20T12:00:00Z')`);
  const settlement=await run(build({trip}));
  const movement=JSON.parse(await run(`${auth}select record_finance_movement(${q(JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'driver_advance',driver_id:i.driver,amount_cents:9000,occurred_on:'2026-01-20',description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado antes dos recibos'}))}::jsonb)`)).movement_id;
  const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'trip',trip_id:trip,description:'Gastos conferidos',reason:'Conferência no retorno',items:[{id:randomUUID(),category:'fuel',amount_cents:10000,description:'Combustível',occurred_on:'2026-01-20',supplier_name:'Posto QA',payee_type:'driver',no_receipt_reason:'Recibo solicitado',allocations:[{movement_id:movement,amount_cents:4000}]},{id:randomUUID(),category:'food',amount_cents:5000,description:'Alimentação',occurred_on:'2026-01-20',supplier_name:'Restaurante QA',payee_type:'driver',no_receipt_reason:'Recibo solicitado',allocations:[{movement_id:movement,amount_cents:5000}]}]};
  return {trip,settlement,movement,payload,money:await run(`select to_jsonb(m) from finance_movements m where id=${q(movement)}`)};
 }
 async function state(f){return JSON.parse(await run(`select json_build_object('snapshot',snapshot_json,'cost',expenses_total,'approved',approved_expenses_total,'result',route_result,'driver_credit',driver_payable_amount,'reimbursement',driver_reimbursement_total,'stale',needs_recalculation,'status',status) from driver_settlements where id=${q(f.settlement)}`));}
 async function counts(f,{items=2,derived=0,payables=1}={}){
  assert.equal(await run(`select count(*) from finance_expense_items e join finance_expense_batches b on b.id=e.batch_id where b.trip_id=${q(f.trip)}`),String(items));
  assert.equal(await run(`select count(*) from driver_settlement_items where settlement_id=${q(f.settlement)} and source_table='finance_expense_items'`),String(derived));
  assert.equal(await run(`select count(*) from payables where source_table='finance_expense_items' and source_id in (${f.payload.items.map(x=>q(x.id)).join(',')})`),String(payables));
  assert.equal(await run(`select to_jsonb(m) from finance_movements m where id=${q(f.movement)}`),f.money);
  assert.equal(await run(`select count(*) from driver_settlement_payments where settlement_id=${q(f.settlement)}`),'0');
 }
 async function nowait(holderSql,rejectedSql,pattern){
  const holder=session('trip-cost-holder',database);holder.send(`begin;${holderSql};select '__COST_HOLDER_READY__';`);await waitForMarker(holder,'__COST_HOLDER_READY__');
  const other=await finish(session('trip-cost-nowait',database),`begin;${rejectedSql};commit;`,false);
  assert.notEqual(other.code,0);assert.match(other.error,pattern);assert.ok(!holder.exited,'Holder must still own its lock when NOWAIT fails');
  await finish(holder,'commit;');return other;
 }
 const tests=[
  ['builder first makes batch wait; new cost leaves recalculation flag set after both commit',async()=>{
   const f=await fixture();await contested(build(f),record(f),{database,driver:false});const s=await state(f);assert.equal(s.cost,0);assert.equal(s.stale,true);await counts(f);
   await run(build(f));assert.equal((await state(f)).cost,150);assert.equal((await state(f)).stale,false);await counts(f,{derived:2});
   await run(record(f));await run(build(f));await counts(f,{derived:2});assert.equal((await state(f)).cost,150);
  }],
  ['batch first rejects builder NOWAIT; retry includes the committed source and clears only reviewed flag',async()=>{
   const f=await fixture();await nowait(record(f),build(f),/55P03.*could not obtain lock on row in relation "dispatch_trips"/s);assert.equal((await state(f)).stale,true);await counts(f);
   await run(build(f));const s=await state(f);assert.equal(s.cost,150);assert.equal(s.driver_credit,0);assert.equal(s.reimbursement,0);assert.equal(s.stale,false);await counts(f,{derived:2});
  }],
  ...['approved','paid','closed'].map(status=>[`${status} snapshot stays intact when batch holds trip and protected rebuild is attempted`,async()=>{
   const f=await fixture();await run(`update driver_settlements set status=${q(status)} where id=${q(f.settlement)}`);const original=await state(f);
   await nowait(record(f),build(f),/55P03.*could not obtain lock on row in relation "dispatch_trips"/s);const after=await state(f);assert.deepEqual(after.snapshot,original.snapshot);assert.equal(after.cost,original.cost);assert.equal(after.status,status);assert.equal(after.stale,true);await counts(f);
   await assert.rejects(()=>run(build(f)),/settlement_locked/);assert.deepEqual((await state(f)).snapshot,original.snapshot);
  }]),
  ['settlement row held elsewhere rejects the entire batch and its payable, then retry succeeds once',async()=>{
   const f=await fixture();await nowait(`select id from driver_settlements where id=${q(f.settlement)} for update`,record(f),/55P03.*could not obtain lock on row in relation "driver_settlements"/s);
   await counts(f,{items:0,payables:0});assert.equal((await state(f)).stale,false);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');
   await run(record(f));assert.equal((await state(f)).stale,true);await run(build(f));await counts(f,{derived:2});assert.equal((await state(f)).cost,150);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
