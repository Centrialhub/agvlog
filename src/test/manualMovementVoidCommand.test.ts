// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createMovementCorrectionContextDatabase} from './helpers/movementCorrectionContextDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {financeAuditSchema,financeAuditActions} from '@/lib/financial/financeAuditContract';
let db:Awaited<ReturnType<typeof createMovementCorrectionContextDatabase>>;
beforeAll(async()=>{db=await createMovementCorrectionContextDatabase();await db.exec(readFileSync('supabase/migrations/20260910191905_finance_manual_movement_void_command.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function setup(direction='out'){
 const original=randomUUID();const id=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:original,bank_account_id:i.account,direction,nature:'other',amount_cents:5000,occurred_on:'2026-08-15',description:'Registro manual duplicado por engano',beneficiary_name:'Fornecedor QA',reason:'Registro original da movimentação'}])).rows[0].v.movement_id;
 const context=(await db.query<{v:{revision:string}}>('select finance_private.movement_correction_context($1,$2) v',[i.tenant,id])).rows[0].v;
 return {original,id,payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_id:id,revision:context.revision,reason:'Lançamento registrado por engano, conferido com financeiro'}};
}
async function command(payload:unknown){return(await db.query<{v:Record<string,unknown>}>('select finance_private.void_manual_movement($1) v',[payload])).rows[0].v;}
async function rejects(action:()=>Promise<unknown>,message:string){await db.exec('savepoint expected_error');await expect(action()).rejects.toThrow(message);await db.exec('rollback to savepoint expected_error');}
it('invalidates a free manual outgoing once, preserves original and records actor/reason/effects',async()=>{
 const m=await setup(),before=(await db.query('select * from finance_movements where id=$1',[m.id])).rows[0];const result=await command(m.payload);
 expect(result).toMatchObject({confirmed:true,movement_id:m.id,original_request_id:m.original,kind:'void',bank_money_transacted:false,recorded_balance_changed:true,actor_id:i.operator,reason:m.payload.reason,effects:{balance_delta_cents:'5000'}});
 expect((await db.query('select * from finance_movements where id=$1',[m.id])).rows[0]).toEqual(before);
 expect((await db.query('select count(*)::int n from finance_private.active_movements where id=$1',[m.id])).rows[0]).toEqual({n:0});
 expect((await db.query("select count(*)::int n from finance_events where action='movement_voided' and entity_id=$1",[m.id])).rows[0]).toEqual({n:1});
 const audit=financeAuditSchema.parse((await db.query<{v:unknown}>('select finance_private.audit_events($1,$2) v',[i.tenant,{page:1,page_size:30,manual_only:true,action:'movement_voided'}])).rows[0].v);
 expect(audit).toMatchObject({total:1,manual_count:1,rows:[{action:'movement_voided',entity_id:m.id,actor_id:i.operator,reason:m.payload.reason,manual_intervention:true}]});
 expect(financeAuditActions.movement_voided).toContain('manualmente');
 expect((await db.query('select count(*)::int n from finance_private.movement_void_write_tickets')).rows[0]).toEqual({n:0});
 await db.exec('set constraints all immediate;set constraints all deferred');
 expect(await command(m.payload)).toEqual(result);
 await rejects(()=>command({...m.payload,reason:'Outro motivo para mesmo pedido'}),'finance_request_conflict');
});
it('uses the opposite recorded balance delta for a manual incoming and prevents a second correction',async()=>{
 const m=await setup('in');expect(await command(m.payload)).toMatchObject({effects:{inflow_delta_cents:'-5000',outflow_delta_cents:'0',balance_delta_cents:'-5000'}});
 await rejects(()=>command({...m.payload,request_id:randomUUID()}),'finance_movement_correction_changed');
 expect((await db.query('select count(*)::int n from finance_movement_voids')).rows[0]).toEqual({n:1});
});
it('rejects a preview made stale by a real payment without changing money or the obligation',async()=>{
 const m=await setup(),p=(await db.query<{id:string}>("insert into payables(tenant_id,supplier_name,category,amount,status) values($1,'Fornecedor QA','other',50,'approved') returning id",[i.tenant])).rows[0].id;
 await financeAs(db,i.operator,'select apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:p,movement_id:m.id,amount_cents:5000,method:'pix',reason:'Pagamento conferido antes da correção'}]);
 await rejects(()=>command(m.payload),'finance_movement_correction_changed');
 const revision=(await db.query<{v:string}>("select finance_private.movement_correction_context($1,$2)->>'revision' v",[i.tenant,m.id])).rows[0].v;
 await rejects(()=>command({...m.payload,revision}),'finance_movement_correction_blocked');
 expect((await db.query('select count(*)::int n from finance_movement_voids')).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from payables_payments')).rows[0]).toEqual({n:1});
});
it('requires the private command ticket even for an owner insertion with apparently valid fields',async()=>{
 const m=await setup();await rejects(()=>db.query(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values($1,$2,$3,$4,'void',$5,'Financeiro QA','Invalidação sem comando', $6,finance_private.movement_correction_context($1,$2))`,[i.tenant,m.id,m.original,m.payload.request_id,i.operator,m.payload.revision]),'finance_movement_correction_command_required');
});
it('does not allow newly created polymorphic obligations to reuse an invalidated movement',async()=>{
 const m=await setup();await command(m.payload);
 await rejects(()=>db.query("insert into payables(tenant_id,supplier_name,category,amount,status,source_table,source_id) values($1,'Fornecedor QA','other',50,'approved','finance_movements',$2)",[i.tenant,m.id]),'finance_movement_voided');
});
it('denies drift of the correction guard before any event or money change',async()=>{
 const m=await setup();await db.exec("create or replace function finance_private.guard_manual_movement_void() returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$");
 await rejects(()=>command(m.payload),'finance_movement_correction_runtime_not_ready');expect((await db.query('select count(*)::int n from finance_movement_voids')).rows[0]).toEqual({n:0});
});
it('rejects reuse of either invalidated transfer leg or an invalidated departure',async()=>{
 const outgoing=await setup(),incoming=await setup('in');await command(outgoing.payload);
 await rejects(()=>db.query('insert into finance_internal_transfers(tenant_id,outgoing_id,incoming_id,created_by) values($1,$2,$3,$4)',[i.tenant,outgoing.id,incoming.id,i.operator]),'finance_movement_voided');
 await rejects(()=>db.query('insert into finance_transfer_departures(tenant_id,outgoing_id,destination_account_id,created_by) values($1,$2,$3,$4)',[i.tenant,outgoing.id,i.account,i.operator]),'finance_movement_voided');
 await command(incoming.payload);const active=await setup();
 await rejects(()=>db.query('insert into finance_internal_transfers(tenant_id,outgoing_id,incoming_id,created_by) values($1,$2,$3,$4)',[i.tenant,active.id,incoming.id,i.operator]),'finance_movement_voided');
});
it('rolls the void, ticket and command back when audit persistence fails',async()=>{
 const m=await setup();
 // Fault injection at the audit boundary, not a replacement for domain logic.
 await db.exec("create function public.qa_reject_void_audit() returns trigger language plpgsql as $$begin if new.action='movement_voided' then raise exception 'qa_audit_write_failed';end if;return new;end$$;create trigger qa_reject_void_audit before insert on finance_events for each row execute function public.qa_reject_void_audit()");
 await rejects(()=>command(m.payload),'qa_audit_write_failed');
 expect((await db.query('select count(*)::int n from finance_movement_voids')).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from finance_commands where request_id=$1',[m.payload.request_id])).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from finance_private.movement_void_write_tickets')).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from finance_private.active_movements where id=$1',[m.id])).rows[0]).toEqual({n:1});
});
it('keeps the command private and rechecks mixed-driver authorization even on replay',async()=>{
 const m=await setup();await expect(financeAs(db,i.operator,'select finance_private.void_manual_movement($1)',[m.payload])).rejects.toThrow('permission denied');
 await command(m.payload);await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);
 await rejects(()=>command(m.payload),'finance_access_denied');
});
