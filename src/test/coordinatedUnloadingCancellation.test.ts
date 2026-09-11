// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,afterEach,expect,it} from 'vitest';
import {createCoordinatedUnloadingCancellationDatabase,installCoordinatedCancellation,seedUnloadingRepairSource} from './helpers/coordinatedUnloadingCancellationDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {unloadingCancellationPreviewSchema,unloadingCancellationResultSchema} from '@/lib/financial/unloadingCancellationContract';
let db:Awaited<ReturnType<typeof createCoordinatedUnloadingCancellationDatabase>>;
beforeAll(async()=>{db=await createCoordinatedUnloadingCancellationDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function preview(charge:string){const value=(await financeAs<{v:Record<string,unknown>}>(db,i.operator,'select preview_finance_unloading_cancellation($1,$2,$3) v',[i.tenant,charge,'2026-08-04'])).rows[0].v;expect(value).not.toHaveProperty('_evidence');return unloadingCancellationPreviewSchema.parse(value);}
async function command(payload:unknown){await db.exec('savepoint cancel_test');try{const result=(await financeAs<{v:unknown}>(db,i.operator,'select cancel_finance_unloading($1) v',[payload])).rows[0].v;await db.exec('release savepoint cancel_test');return unloadingCancellationResultSchema.parse(result);}catch(e){await db.exec('rollback to savepoint cancel_test');throw e;}}
it('atomically cancels cost150, exact payable150 and collection150 while retaining one original charge and expense',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const p=await preview(c.charge_id);expect(p.blockers).toEqual([]);
 const beforeSummary=(await db.query<{v:unknown}>('select get_finance_recorded_cost_summary($1,$2,$3,$4,$5) v',[i.tenant,'2026-08-01','2026-08-31',null,null])).rows[0].v;expect(beforeSummary).toMatchObject({total_cents:'15000'});
 const original=(await db.query('select to_jsonb(e) v from finance_expense_items e')).rows;const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Cancelamento conjunto de lançamento indevido'};
 const result=await command(payload);expect(await command(payload)).toEqual(result);expect(result).toMatchObject({cost_removed_cents:'15000',obligation_cancelled_cents:'15000',collection_cancelled_cents:'15000'});
 expect((await db.query('select to_jsonb(e) v from finance_expense_items e')).rows).toEqual(original);expect((await db.query('select count(*)::int n from finance_private.active_expense_items')).rows).toEqual([{n:0}]);expect((await db.query("select status from payables where id=$1",[result.payable_id])).rows).toEqual([{status:'cancelled'}]);expect((await db.query("select status,trunc(amount*100)::text amount from receivables where id=$1",[c.receivable_id])).rows).toEqual([{status:'cancelled',amount:'15000'}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.unloading_cost_cancellation_tickets')).rows).toEqual([{n:0}]);await db.exec('set constraints all immediate');expect((await db.query<{v:unknown}>('select get_finance_recorded_cost_summary($1,$2,$3,$4,$5) v',[i.tenant,'2026-08-01','2026-08-31',null,null])).rows[0].v).toMatchObject({total_cents:'0'});
});

it('rolls back both child cancellations and the ticket when parent audit fails',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const p=await preview(c.charge_id);
 await db.exec("create function public.reject_coordinated_audit() returns trigger language plpgsql as $$begin if new.action='unloading_cancelled_coordinated' then raise exception 'audit_failure';end if;return new;end$$;create trigger reject_coordinated_audit before insert on finance_events for each row execute function public.reject_coordinated_audit()");
 await expect(command({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Teste de atomicidade dos três efeitos'})).rejects.toThrow('audit_failure');
 expect((await db.query('select count(*)::int n from finance_expense_cancellations')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.unloading_cost_cancellation_tickets')).rows).toEqual([{n:0}]);expect((await preview(c.charge_id)).eligible).toBe(true);
});
it('keeps the generic unloading cancellation blocked, requires its private ticket, and rechecks revision and actor',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const p=await preview(c.charge_id);
 expect((await db.query<{v:{issue:string}}>('select finance_private.expense_cancellation_context($1,$2) v',[i.tenant,p.expense_id])).rows[0].v.issue).toBe('finance_expense_unloading_requires_resolution');
 await db.exec('savepoint no_ticket');await expect(db.query('select finance_private.cancel_unloading_cost($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:p.expense_id,revision:p.revision,reason:'Sem autorização coordenada'}])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint no_ticket');
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Cancelamento para teste de revisão'};
 await db.query('update receivables set notes=$1 where id=$2',['Informação atualizada',c.receivable_id]);await expect(command(payload)).rejects.toMatchObject({code:'40001'});
 await expect(command({...payload,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(command(payload)).rejects.toMatchObject({code:'42501'});
 expect((await db.query("select has_function_privilege('authenticated','finance_private.cancel_unloading_cost(jsonb)','execute') allowed")).rows).toEqual([{allowed:false}]);
});
it('blocks an inconsistent paid obligation and a materialized cost without changing the collection',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const p=await preview(c.charge_id);
 await db.query("update payables set status='paid' where id=$1",[p.payable_id]);expect((await preview(c.charge_id)).blockers.some(x=>x.code==='finance_expense_payable_inconsistent')).toBe(true);
 await db.exec('savepoint restore_case');
 // A stored settlement item is dependency evidence, not a simulated builder result; the real builder is exercised in unloadingOriginAmendments.
 await db.query("insert into driver_settlement_items(id,tenant_id,settlement_id,item_type,source_table,source_id,description,amount,metadata,created_at) values($1,$2,$3,'expense','finance_expense_items',$4,'Custo materializado',150,'{}',clock_timestamp())",[randomUUID(),i.tenant,randomUUID(),p.expense_id]);
 expect((await preview(c.charge_id)).blockers.some(x=>x.code==='unloading_cost_materialized')).toBe(true);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:0}]);
});

it('cancels an explicitly amended collection120 together with original cost/payable150',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);
 const proposal={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const ctx=(await db.query<{v:{revision:string}}>('select finance_private.unloading_origin_correction_context($1,$2,$3) v',[i.tenant,c.charge_id,proposal])).rows[0].v;
 await db.query('select finance_private.correct_unloading_origin($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,revision:ctx.revision,proposal,reason:'Alteração anterior apenas da cobrança'}]);
 const p=await preview(c.charge_id);expect(p.eligible).toBe(true);expect(p.effects).toMatchObject({cost_removed_cents:'15000',obligation_cancelled_cents:'15000',collection_cancelled_cents:'12000'});
 await command({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Cancelamento coordenado após revisão do direito'});
 expect((await preview(c.charge_id)).history).toHaveLength(1);expect((await db.query('select count(*)::int n from finance_unloading_charges')).rows).toEqual([{n:1}]);
});
it('blocks after an actual receipt and preserves all money and cost rows',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);
 const financial=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_receivable_financial_context($1,$2) v',[i.tenant,c.receivable_id])).rows[0].v;
 const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:'2026-08-03',description:'Recebimento parcial da descarga',beneficiary_name:'Fornecedor preservado',reason:'Dinheiro recebido e registrado'}])).rows[0].v;
 await financeAs(db,i.operator,'select apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),actor_id:i.operator,receivable_id:c.receivable_id,expected_revision:financial.revision,action:'receive',amount_cents:1000,effective_date:'2026-08-03',bank_account_id:i.account,method:'pix',movement_id:movement.movement_id,reason:'Recebimento parcial registrado'}]);
 const p=await preview(c.charge_id);expect(p.eligible).toBe(false);expect(p.blockers.some(x=>x.source_table==='receivables_payments')).toBe(true);
 await expect(command({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Tentativa bloqueada com dinheiro recebido'})).rejects.toMatchObject({code:'55000'});
 expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:1}]);expect((await db.query('select count(*)::int n from finance_expense_cancellations')).rows).toEqual([{n:0}]);
});

it('retains final dependency and immutable guards and rejects new payment/allocation after cancellation',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const p=await preview(c.charge_id);
 const guard=(await db.query<{v:boolean}>("select position('pg_try_advisory_xact_lock' in prosrc)>0 v from pg_proc where oid='finance_private.guard_cancelled_expense_dependency()'::regprocedure")).rows[0].v;expect(guard).toBe(true);
 const triggers=(await db.query<{tgname:string}>("select tgname from pg_trigger where not tgisinternal and tgname in('finance_cancelled_expense_payroll','finance_cancelled_expense_settlement','finance_cancelled_expense_obligation','finance_cancelled_expense_advance','preserve_expense_cancellation') and tgenabled in('O','A')")).rows;expect(triggers).toHaveLength(5);
 await command({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,effective_on:'2026-08-04',revision:p.revision,reason:'Cancelamento antes de novas dependências'});
 await db.exec('savepoint new_payment');await expect(db.query("insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,created_by,created_at) values($1,$2,$3,1,'2026-08-04',$4,'pix',$5,clock_timestamp())",[randomUUID(),i.tenant,p.payable_id,i.account,i.operator])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint new_payment');
 const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:100,occurred_on:'2026-08-04',description:'Saída real ainda sem alocação',beneficiary_name:'Prestador',reason:'Movimento para provar bloqueio residual'}])).rows[0].v;
 await db.exec('savepoint new_allocation');await expect(db.query('insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values($1,$2,$3,100,$4)',[i.tenant,p.expense_id,movement.movement_id,i.operator])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint new_allocation');
 await db.exec('savepoint erase_history');await expect(db.query('delete from finance_expense_cancellations where tenant_id=$1 and expense_id=$2',[i.tenant,p.expense_id])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint erase_history');
 expect((await db.query('select count(*)::int n from payables_payments')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_expense_allocations')).rows).toEqual([{n:0}]);
});
