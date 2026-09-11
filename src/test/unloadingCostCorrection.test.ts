// @vitest-environment node
import {readFileSync} from 'node:fs';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {randomUUID} from 'node:crypto';import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {unloadingCostCorrectionPreviewSchema,unloadingCostCorrectionResultSchema} from '@/lib/financial/unloadingCostCorrectionContract';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function preview(charge:string,amount='12000'){const raw=(await db.query<{v:Record<string,unknown>}>('select finance_private.unloading_cost_correction_context($1,$2,$3) v',[i.tenant,charge,amount])).rows[0].v;const {_evidence,...safe}=raw;expect(_evidence).toBeDefined();return unloadingCostCorrectionPreviewSchema.parse(safe);}
async function command(payload:unknown){await db.exec('savepoint cost_test');try{const result=(await db.query<{v:{amendment_id:string,approval_reset:boolean,payable_status:string,cost_after_cents:string}}> ('select finance_private.correct_unloading_cost($1) v',[payload])).rows[0].v;await db.exec('release savepoint cost_test');return unloadingCostCorrectionResultSchema.parse(result);}catch(e){await db.exec('rollback to savepoint cost_test');throw e;}}
it('revises cost150 to120 to180, resets approved debt and preserves source and collection',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);const first=await preview(c.charge_id);await db.query("update payables set status='approved' where id=$1",[first.payable_id]);const p=await preview(c.charge_id);expect(p.blockers).toEqual([]);expect(p.approval_reset).toBe(true);
 const original=(await db.query('select to_jsonb(e) v from finance_expense_items e')).rows;const collection=(await db.query('select to_jsonb(r) v from receivables r')).rows;
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'12000',revision:p.revision,reason:'Retificação do valor comprado com nova aprovação'};const result=await command(payload);expect(result).toMatchObject({approval_reset:true,payable_status:'pending',cost_after_cents:'12000'});expect(await command(payload)).toEqual(result);
 const next=await preview(c.charge_id,'18000');expect(next.blockers).toEqual([]);await command({...payload,request_id:randomUUID(),amount_cents:'18000',revision:next.revision});await db.exec('set constraints all immediate;set constraints all deferred');
 expect((await db.query('select to_jsonb(e) v from finance_expense_items e')).rows).toEqual(original);expect((await db.query('select to_jsonb(r) v from receivables r')).rows).toEqual(collection);expect((await db.query('select trunc(amount*100)::text cents,status from payables where id=$1',[p.payable_id])).rows).toEqual([{cents:'18000',status:'pending'}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
 const cancel=(await financeAs<{v:{revision:string,effects:{cost_removed_cents:string}}}>(db,i.operator,'select preview_finance_unloading_cancellation($1,$2,$3) v',[i.tenant,c.charge_id,'2026-08-04'])).rows[0].v;expect(cancel.effects.cost_removed_cents).toBe('18000');await financeAs(db,i.operator,'select cancel_finance_unloading($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:cancel.revision,reason:'Cancelar o custo retificado e sua obrigação'}]);expect((await db.query('select status from payables where id=$1',[p.payable_id])).rows).toEqual([{status:'cancelled'}]);
});

async function rpc<T>(name:string,payload:unknown){return(await financeAs<{v:T}>(db,i.operator,'select '+name+'($1) v',[payload])).rows[0].v;}
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência real do complemento da descarga'});
async function movement(cents:number){return rpc<{movement_id:string}>('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:cents,occurred_on:'2026-08-02',description:'Pagamento de descarga conferido',beneficiary_name:'Prestador'});}
it('preserves the real 500 cost with 300 allocated and 200 complement across installation',async()=>{
 await seedUnloadingRepairSource(db,true);
 const seed=(await db.query<{trip_id:string,supplier_id:string,receipt_path:string}>('select b.trip_id,e.supplier_id,e.receipt_path from finance_expense_items e join finance_expense_batches b on b.id=e.batch_id')).rows[0];
 async function partial(){
  const stop=randomUUID(),doc=randomUUID();await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,status,client_id,destination) values($1,$2,$3,2,'completed',$4,'Entrega complemento')",[stop,i.tenant,seed.trip_id,seed.supplier_id]);
  await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status) values($1,$2,$3,$3,'inbound','ready')",[doc,i.tenant,seed.supplier_id]);await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',[i.tenant,stop,doc]);
  const ctx=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_delivery_context($1,$2) v',[i.tenant,stop])).rows[0].v;
  const m=await movement(30000),expense=randomUUID();await rpc('record_finance_expense_batch',{...base(),context:'trip',trip_id:seed.trip_id,description:'Custo500 com complemento200',items:[{id:expense,category:'unloading',description:'Serviço parcialmente pago',amount_cents:50000,occurred_on:'2026-08-02',due_date:'2026-08-20',supplier_id:seed.supplier_id,supplier_name:'Prestador diferente do devedor',payee_type:'supplier',receipt_path:seed.receipt_path,allocations:[{movement_id:m.movement_id,amount_cents:30000}],stop_id:stop,delivery_revision:ctx.revision}]});
  return(await db.query<{payable_id:string}>('select payable_id from finance_expense_items where id=$1',[expense])).rows[0].payable_id;
 }
 async function pay(id:string){await db.query("update payables set status='approved' where id=$1",[id]);const m=await movement(20000);await rpc('apply_finance_payable_movement',{...base(),payable_id:id,movement_id:m.movement_id,amount_cents:20000,method:'pix'});expect((await db.query('select trunc(amount*100)::text cents from payables where id=$1',[id])).rows).toEqual([{cents:'20000'}]);expect((await db.query('select amount_cents::text cents from finance_payable_movement_links where payable_id=$1',[id])).rows).toEqual([{cents:'20000'}]);}
 const before=await partial();await pay(before);const spanning=await partial();await installUnloadingCostCorrection(db);await pay(spanning);await pay(await partial());
 expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:3}]);
});

it('rejects stale revision, direct nominal edits, mixed driver and atomically rolls back an audit failure',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);const p=await preview(c.charge_id);const payload={...base(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'12000',revision:p.revision};
 await expect(command({...payload,revision:'0'.repeat(32)})).rejects.toThrow('finance_unloading_cost_changed');
 await db.exec('savepoint edit');await expect(db.query('update payables set amount=120 where id=$1',[p.payable_id])).rejects.toThrow('finance_unloading_cost_ticket_required');await db.exec('rollback to savepoint edit');
 await db.exec('savepoint mixed');await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(command(payload)).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint mixed');
 await db.exec("create function public.qa_cost_audit_fault() returns trigger language plpgsql as $$begin if new.action='unloading_cost_corrected' then raise exception 'qa_cost_audit_fault';end if;return new;end$$;create trigger qa_cost_audit_fault before insert on finance_events for each row execute function public.qa_cost_audit_fault()");
 await expect(command(payload)).rejects.toThrow('qa_cost_audit_fault');expect((await db.query('select amount from payables where id=$1',[p.payable_id])).rows).toEqual([{amount:'150.00'}]);expect((await db.query('select count(*)::int n from finance_private.expense_cost_tickets')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.expense_cost_amendments')).rows).toEqual([{n:0}]);
 await db.exec('drop trigger qa_cost_audit_fault on finance_events');await command(payload);await expect(command({...payload,amount_cents:'13000'})).rejects.toThrow('finance_request_conflict');
 await db.exec('savepoint history');await expect(db.exec("update finance_private.expense_cost_amendments set reason='Alteração indevida do histórico'")).rejects.toThrow();await db.exec('rollback to savepoint history');
});

it('keeps the effective version verifiable after real payment while blocking another correction',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);const p=await preview(c.charge_id);await command({...base(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'12000',revision:p.revision});const extra=await movement(1000);await db.exec('savepoint late_allocation');await expect(db.query('insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values($1,$2,$3,1000,$4)',[i.tenant,p.expense_id,extra.movement_id,i.operator])).rejects.toThrow('finance_unloading_cost_allocation_requires_command');await db.exec('rollback to savepoint late_allocation');await db.query("update payables set status='approved' where id=$1",[p.payable_id]);const m=await movement(12000);await rpc('apply_finance_payable_movement',{...base(),payable_id:p.payable_id,movement_id:m.movement_id,amount_cents:12000,method:'pix'});
 const after=await preview(c.charge_id,'18000');expect(after.cost.verified).toBe(true);expect(after.cost.effective_amount_cents).toBe('12000');expect(after.eligible).toBe(false);expect(after.blockers.length).toBeGreaterThan(0);await expect(command({...base(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'18000',revision:after.revision})).rejects.toThrow('finance_unloading_cost_blocked');
 expect((await db.query('select amount_cents::text cents from finance_payable_movement_links where payable_id=$1',[p.payable_id])).rows).toEqual([{cents:'12000'}]);await db.exec('set constraints all immediate');
});

it('blocks correction under a real closure and allows it after an audited reopening',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};const rpc=async<T>(name:string,args:unknown[])=>(await financeAs<{v:T}>(db,i.operator,'select '+name+'('+args.map((_,n)=>'$'+(n+1)).join(',')+') v',args)).rows[0].v;const closeCommand=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Fechamento bancário real do período sem movimento'});
 await seedAccountCloseStatement(db,'2026-07-31',10000);await seedAccountCloseStatement(db,'2026-08-31',10000,scope.from,scope.to);await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 for(const [writer,reader,extra] of [['record_finance_account_opening','get_finance_statement_period_evidence',{}],['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}]] as const){const evidence=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...closeCommand(),...scope,revision:evidence.revision,...extra}]);}
 const closePreview=await rpc<{revision:string}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);const closed=await rpc<{closure_id:string,revision:string}>('close_finance_account_period',[{...closeCommand(),...scope,revision:closePreview.revision}]);
 const p=await preview(c.charge_id);expect(p.eligible).toBe(false);expect(p.blockers.some(x=>x.code.includes('closed'))).toBe(true);await expect(command({...base(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'12000',revision:p.revision})).rejects.toMatchObject({code:'55000'});
 await rpc('reopen_finance_account_period',[{...closeCommand(),closure_id:closed.closure_id,revision:closed.revision}]);expect((await preview(c.charge_id)).eligible).toBe(true);
});
it('blocks positive cost correction when a real settlement has already materialized the original cost',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const match of baseline.matchAll(/CREATE TYPE public\.([a-z_]+) AS ENUM \([\s\S]*?\);/g))if(!(await db.query<{v:boolean}>('select to_regtype($1) is not null v',['public.'+match[1]])).rows[0].v)await db.exec(match[0]);
 await db.exec('create schema settlement_test_definitions');
 for(const table of ['driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','driver_expenses','dispatch_trip_loads','loads','trip_routes']){
  const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw new Error(table);
  if(!(await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)await db.exec(ddl);
  else{
   await db.exec(ddl.replace('public.'+table,'settlement_test_definitions.'+table));
   const columns=(await db.query<{name:string,type:string}>("select attname name,format_type(atttypid,atttypmod) type from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['settlement_test_definitions.'+table])).rows;
   for(const col of columns)await db.exec('alter table public.'+table+' add column if not exists "'+col.name+'" '+col.type);
  }
  for(const d of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\s+ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(d[0]);
 }
 for(const name of ['_log_settlement_event','_build_driver_settlement']){const fn=baseline.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))?.[0];if(!fn)throw new Error(name);await db.exec(fn);}
 const costs=readFileSync('supabase/migrations/20260910134948_finance_canonical_trip_cost_settlement.sql','utf8');await db.exec(costs.slice(costs.indexOf('do $patch$'),costs.indexOf('-- Extend, rather than bypass')));
 const trip=(await db.query<{id:string}>('select b.trip_id id from finance_expense_items e join finance_expense_batches b on b.id=e.batch_id where e.unloading_id=$1',[c.charge_id])).rows[0].id;
 await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.driver,trip]);
 const settlement=(await db.query<{id:string}>('select _build_driver_settlement($1,$2) id',[i.tenant,trip])).rows[0].id;
 const before=(await db.query('select to_jsonb(s) v from driver_settlements s where id=$1',[settlement])).rows;
 const items=(await db.query<{v:{source_table:string,amount:number}}>('select to_jsonb(x) v from driver_settlement_items x where settlement_id=$1 order by id',[settlement])).rows;
 expect(items.some(x=>(x.v as {source_table:string,amount:number}).source_table==='finance_expense_items'&&(x.v as {amount:number}).amount===150)).toBe(true);
 const p=await preview(c.charge_id);expect(p.eligible).toBe(false);expect(p.blockers.some(x=>x.code==='unloading_cost_materialized')).toBe(true);await expect(command({...base(),charge_id:c.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:'12000',revision:p.revision})).rejects.toThrow('finance_unloading_cost_blocked');
 expect((await db.query('select to_jsonb(s) v from driver_settlements s where id=$1',[settlement])).rows).toEqual(before);expect((await db.query('select to_jsonb(x) v from driver_settlement_items x where settlement_id=$1 order by id',[settlement])).rows).toEqual(items);
});

