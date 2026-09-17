// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createEmployeeAdvanceRecordedPaymentReviewDatabase} from './helpers/employeeAdvanceRecordedPaymentReviewDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createEmployeeAdvanceRecordedPaymentReviewDatabase();},60000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>{await db.exec('rollback');});
async function employee(){const id=randomUUID();await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Advance review employee')",[id,i.tenant]);return id;}
async function register(id:string,paid:boolean){return(await financeAs<{id:string}>(db,i.operator,'select public.register_employee_advance($1,$2,100,current_date,$3,$4,null,false,$5) id',[i.tenant,id,'Independent advance behavior review','pix',paid])).rows[0].id;}
it('current protected register rejects UI mark_paid with no bank, advance or payment residue',async()=>{const id=await employee();await db.exec('savepoint rejected');await expect(register(id,true)).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint rejected');expect((await db.query<{n:number}>('select count(*)::int n from employee_advances where employee_id=$1',[id])).rows[0].n).toBe(0);expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(0);});
it('reproduces UI direct paid status update with active period guard and no canonical cash evidence',async()=>{const id=await employee(),advance=await register(id,false);
 const guards=(await db.query<{tgname:string}>('select tgname from pg_trigger where tgrelid=\'public.employee_advances\'::regclass and tgenabled=\'O\' order by tgname')).rows.map(r=>r.tgname);expect(guards).toContain('finance_late_paid_projection');expect(guards).toContain('finance_closed_period_source');
 await financeAs(db,i.operator,"update employee_advances set status='paid',paid_by=$1,paid_at=now(),updated_at=now() where id=$2",[i.operator,advance]);await db.exec('set constraints all immediate');
 expect((await db.query('select status,payable_id from employee_advances where id=$1',[advance])).rows[0]).toEqual({status:'paid',payable_id:null});
 const proof=(await db.query<{v:{valid:boolean,issue:string,footprints:unknown[]}}>('select finance_private.paid_projection_chain($1,$2,$3) v',[i.tenant,'employee_advances',advance])).rows[0].v;expect(proof.valid).toBe(false);expect(proof.issue).toBe('advance_title_chain_invalid');expect(proof.footprints).toEqual([]);
 expect((await db.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n).toBe(0);expect((await db.query<{n:number}>('select count(*)::int n from payables_payments')).rows[0].n).toBe(0);
});
it.each([4000,10000])('canonical existing outgoing of %i cents preserves the actual delivered amount and current advance status',async(amount)=>{
 const id=await employee();const advance=(await financeAs<{id:string}>(db,i.operator,'select public.register_employee_advance($1,$2,100,current_date,$3,$4,null,true,false) id',[i.tenant,id,'Real recorded outgoing review','pix'])).rows[0].id;
 const payable=(await db.query<{payable_id:string}>('select payable_id from employee_advances where id=$1',[advance])).rows[0].payable_id;await db.query("update payables set status='approved' where id=$1",[payable]);
 const date=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Actual recorded outgoing for advance'});
 const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select public.record_finance_movement($1) v',[{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:amount,occurred_on:date,description:'Existing employee advance outgoing',beneficiary_name:'Advance review employee'}])).rows[0].v;
 const before=(await db.query('select to_jsonb(b) value from bank_transactions b order by id')).rows;
 await financeAs(db,i.operator,'select public.apply_finance_payable_movement($1)',[{...base(),movement_id:movement.movement_id,payable_id:payable,amount_cents:amount,method:'pix'}]);await db.exec('set constraints all immediate');
 expect((await db.query('select status from employee_advances where id=$1',[advance])).rows[0]).toEqual({status:amount===10000?'paid':'approved'});
 expect((await db.query<{paid_amount:string}>('select trunc(paid_amount*100)::text paid_amount from payables where id=$1',[payable])).rows[0].paid_amount).toBe(String(amount));
 const chain=(await db.query<{v:{valid:boolean,issue:string|null,footprints:unknown[]}}>('select finance_private.paid_projection_chain($1,$2,$3) v',[i.tenant,'employee_advances',advance])).rows[0].v;expect(chain.valid).toBe(amount===10000);expect(chain.issue).toBe(amount===10000?null:'advance_not_paid');expect(chain.footprints).toHaveLength(1);
 expect((await db.query('select to_jsonb(b) value from bank_transactions b order by id')).rows).toEqual(before);
});
