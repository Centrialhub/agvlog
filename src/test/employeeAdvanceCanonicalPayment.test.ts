// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createEmployeeAdvanceCanonicalPaymentDatabase} from './helpers/employeeAdvanceCanonicalPaymentDatabase';
import {employeeAdvancePaymentPreviewSchema,employeeAdvancePaymentResultSchema,employeeAdvancePaymentOptionsSchema,employeeAdvancePaymentHistorySchema} from '../lib/financial/employeeAdvancePaymentContract';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
it('installs canonical advance payment against current predecessor metadata',async()=>{const db=await createEmployeeAdvanceCanonicalPaymentDatabase();try{
 await db.exec('begin');await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const employee=randomUUID();await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Canonical employee')",[employee,i.tenant]);
 const advance=(await financeAs<{id:string}>(db,i.operator,'select register_employee_advance($1,$2,100,current_date,$3,null,null,false,false) id',[i.tenant,employee,'Canonical payment test'])).rows[0].id;
 await db.query("update employee_advances set status='approved',approved_by=$1,approved_at=now() where id=$2",[i.operator,advance]);
 const pos=(await db.query<{v:{verified:boolean,paid_cents:string,open_cents:string}}>('select finance_private.employee_advance_position($1,$2) v',[i.tenant,advance])).rows[0].v;expect(pos).toMatchObject({verified:true,paid_cents:'0',open_cents:'10000'});
 await db.exec('savepoint invalid_paid');await db.query("update employee_advances set status='paid',paid_at=now(),paid_by=$1 where id=$2",[i.operator,advance]);await expect(db.exec('set constraints all immediate')).rejects.toMatchObject({code:'23514'});await db.exec('rollback to savepoint invalid_paid');
 const day=(await db.query<{v:string}>("select (now() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 for(const amount of ['4000','6000']){
 const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:Number(amount),occurred_on:day,description:'Existing canonical advance outgoing',beneficiary_name:'Canonical employee',reason:'Canonical advance payment evidence'}])).rows[0].v.movement_id;
 const before=(await db.query('select to_jsonb(b) value from bank_transactions b order by id')).rows;
 const ctx=employeeAdvancePaymentPreviewSchema.parse((await db.query<{v:unknown}>('select finance_private.employee_advance_payment_context($1,$2,$3,$4) v',[i.tenant,advance,movement,amount])).rows[0].v);expect(ctx.eligible).toBe(true);
 const options=employeeAdvancePaymentOptionsSchema.parse((await db.query<{v:unknown}>('select finance_private.employee_advance_payment_options($1,$2,$3) v',[i.tenant,advance,{offset:0,limit:30,search:'',expected_revision:null}])).rows[0].v);expect(options.rows.some(r=>r.id===movement)).toBe(true);
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),advance_id:advance,movement_id:movement,amount_cents:amount,expected_revision:ctx.revision,method:'pix',reason:'Canonical payment approved and linked'};
 await db.exec('savepoint stale');await expect(db.query('select finance_private.record_employee_advance_payment($1)',[{...payload,expected_revision:'00000000000000000000000000000000'}])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint stale');
 const result=employeeAdvancePaymentResultSchema.parse((await db.query<{v:unknown}>('select finance_private.record_employee_advance_payment($1) v',[payload])).rows[0].v);expect(result.status).toBe(amount==='4000'?'approved':'paid');
 expect((await db.query<{v:unknown}>('select finance_private.record_employee_advance_payment($1) v',[payload])).rows[0].v).toEqual(result);
 expect((await db.query('select to_jsonb(b) value from bank_transactions b order by id')).rows).toEqual(before);
 await db.exec('set constraints all immediate;set constraints all deferred');
 }
 const compact=(await db.query<{v:Record<string,unknown>}>('select finance_private.employee_advance_position($1,$2) v',[i.tenant,advance])).rows[0].v;expect(compact.payment_count).toBe(2);expect(compact).not.toHaveProperty('footprints');
 const definition=(await db.query<{v:string}>("select lower(pg_get_functiondef('finance_private.employee_advance_position(uuid,uuid)'::regprocedure)) v")).rows[0].v;expect(definition).toContain('payable_portfolio_summary_evidence');expect(definition).not.toContain('payable_portfolio_evidence(t,a.payable_id)');
 const history=employeeAdvancePaymentHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.employee_advance_payment_history($1,$2,$3) v',[i.tenant,advance,{offset:0,limit:30,expected_revision:null}])).rows[0].v);expect(history.total).toBe(2);expect(history.rows).toHaveLength(2);
 await db.exec('rollback');
 }finally{await db.close();}},60000);
