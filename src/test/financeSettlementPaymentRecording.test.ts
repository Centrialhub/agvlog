// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createSettlementPaymentDatabase} from './helpers/financeSettlementPaymentDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createSettlementPaymentDatabase();},30000);
beforeEach(async()=>{await db.exec(`begin;set request.jwt.claim.sub='${i.operator}'`);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
function command(settlement:string,movement:string,patch:Record<string,unknown>={}){return {version:1,tenant_id:i.tenant,request_id:randomUUID(),settlement_id:settlement,movement_id:movement,amount_cents:30000,method:'pix',reason:'Pagamento efetuado e conferido pelo financeiro',...patch};}
async function record(payload:Record<string,unknown>,actor=i.operator){return (await financeAs<{result:Record<string,unknown>}>(db,actor,'select record_finance_settlement_payment($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
async function fixture(){
 const settlement=randomUUID();await db.query("insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount) values($1,$2,$3,'approved',500)",[settlement,i.tenant,i.driver]);
 const p={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',driver_id:i.driver,amount_cents:50000,occurred_on:'2026-01-10',description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado e conferido',bank_reference:'PIX-QA'};
 const movement=(await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1::jsonb) result',[JSON.stringify(p)])).rows[0].result.movement_id;
 return {settlement,movement,payload:command(settlement,movement)};
}
async function payroll(status='calculated',entryStatus='calculated',dateStart='2026-01-01',dateEnd='2026-01-31'){
 const employee=randomUUID(),period=randomUUID(),entry=randomUUID();await db.query("insert into employees(id,tenant_id,driver_id,name) values($1,$2,$3,'Motorista QA')",[employee,i.tenant,i.driver]);
 await db.query("insert into payroll_periods(id,tenant_id,period_name,period_start,period_end) values($1,$2,'Janeiro',$3,$4)",[period,i.tenant,dateStart,dateEnd]);
 await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,driver_id) values($1,$2,$3,$4,$5)",[entry,i.tenant,period,employee,i.driver]);
 await db.query("insert into payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,driver_id,item_type,nature,description,amount,source_table,source_id) values($1,$2,$3,$4,$5,'base_salary','credit','Salário',1000,'employee_contracts',$6),($1,$2,$3,$4,$5,'manual_credit','credit','Crédito manual',75,null,null),($1,$2,$3,$4,$5,'driver_advance','already_paid','Adiantamento',100,'employee_advances',$7)",[i.tenant,period,entry,employee,i.driver,randomUUID(),randomUUID()]);
 await db.query('select recompute_payroll_entry_totals($1)',[entry]);await db.query('update payroll_entries set status=$1 where id=$2',[entryStatus,entry]);await db.query('update payroll_periods set status=$1 where id=$2',[status,period]);
 return {employee,period,entry};
}
async function count(table:string){return Number((await db.query<{n:string}>(`select count(*) n from ${table}`)).rows[0].n);}
it('records existing money, derives account/date/reference and atomically replays without another payment, cash or cost',async()=>{
 const f=await fixture(),result=await record(f.payload);expect(await record(f.payload)).toEqual(result);expect(result).toMatchObject({settlement_id:f.settlement,movement_id:f.movement,amount_cents:30000,cash_created:false,confirmed:true});
 expect(await count('driver_settlement_payments')).toBe(1);expect(await count('finance_settlement_movement_links')).toBe(1);expect(await count('finance_movements')).toBe(1);expect(await count('finance_expense_items')).toBe(0);expect(await count('bank_transactions')).toBe(0);
 expect((await db.query("select amount::text,payment_account,payment_reference,receipt_url,(paid_at at time zone 'America/Sao_Paulo')::text paid_day from driver_settlement_payments")).rows[0]).toMatchObject({amount:'300.0000000000000000',payment_account:'Banco QA',payment_reference:'PIX-QA',receipt_url:null,paid_day:'2026-01-10 12:00:00'});
 expect((await db.query("select status,total_paid_amount::text,payment_balance::text from driver_settlements")).rows[0]).toMatchObject({status:'approved'});
 expect(await count('driver_settlement_events')).toBe(1);expect((await db.query("select count(*)::int n from finance_events where action='settlement_payment_recorded'")).rows[0]).toEqual({n:1});
});
it('sums real prior payments instead of trusting stale caches and marks full settlement paid',async()=>{
 const f=await fixture();await db.query("insert into driver_settlement_payments(tenant_id,settlement_id,amount,paid_at) values($1,$2,200,'2026-01-10T15:00:00Z')",[i.tenant,f.settlement]);await db.query('insert into finance_settlement_movement_links(tenant_id,settlement_id,payment_id,movement_id,amount_cents,created_by) select tenant_id,settlement_id,id,$1,20000,$2 from driver_settlement_payments',[f.movement,i.operator]);await db.query('update driver_settlements set total_paid_amount=499,payment_balance=1 where id=$1',[f.settlement]);
 await record(f.payload);const s=(await db.query<{total_paid_amount:string;payment_balance:string;status:string}>('select * from driver_settlements')).rows[0];expect([Number(s.total_paid_amount),Number(s.payment_balance),s.status]).toEqual([500,0,'paid']);
 await expect(record(command(f.settlement,f.movement,{amount_cents:1}))).rejects.toThrow('finance_settlement_overpaid');expect(await count('driver_settlement_payments')).toBe(2);
});
it('updates only already-paid payment source in editable payroll and preserves remuneration/manual/advance rows',async()=>{
 const f=await fixture(),p=await payroll(),before=(await db.query('select * from payroll_entry_items order by id')).rows;const result=await record(f.payload);
 expect((await db.query('select * from payroll_entry_items where source_id is distinct from $1 order by id',[result.payment_id])).rows).toEqual(before);
 const inserted=(await db.query('select item_type,nature,source_table,source_id from payroll_entry_items where source_id=$1',[result.payment_id])).rows[0];expect(inserted).toEqual({item_type:'driver_settlement_payment',nature:'already_paid',source_table:'driver_settlement_payments',source_id:result.payment_id});
 const sums=(await db.query<{gross_amount:string;already_paid_amount:string;amount_to_pay:string}>('select * from payroll_entries where id=$1',[p.entry])).rows[0];expect([sums.gross_amount,sums.already_paid_amount,sums.amount_to_pay].map(Number)).toEqual([1075,400,675]);await record(f.payload);expect(await count('payroll_entry_items')).toBe(4);
});
it.each(['approved','closed','under_review'])('blocks driver/date related protected %s payroll without partial writes',async(status)=>{
 const f=await fixture();await payroll(status,'approved');await expect(record(f.payload)).rejects.toThrow('finance_settlement_locked_in_payroll');expect(await count('driver_settlement_payments')).toBe(0);expect(await count('finance_settlement_movement_links')).toBe(0);
});
it('blocks protected entries inside otherwise editable payroll',async()=>{const f=await fixture();await payroll('calculated','approved');await expect(record(f.payload)).rejects.toThrow('finance_settlement_locked_in_payroll');});
it('blocks settlement-source protected payroll even when payment date belongs to another month',async()=>{
 const f=await fixture(),p=await payroll('calculated','calculated','2026-02-01','2026-02-28');await db.query("insert into payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,driver_id,item_type,nature,description,amount,source_table,source_id) values($1,$2,$3,$4,$5,'driver_settlement','credit','Acerto',500,'driver_settlements',$6)",[i.tenant,p.period,p.entry,p.employee,i.driver,f.settlement]);await db.query("update payroll_entries set status='approved' where id=$1",[p.entry]);await db.query("update payroll_periods set status='approved' where id=$1",[p.period]);await expect(record(f.payload)).rejects.toThrow('finance_settlement_locked_in_payroll');
});
it('cancelled payroll is preserved and does not get a new already-paid item',async()=>{const f=await fixture();await payroll('cancelled','cancelled');const before=(await db.query('select * from payroll_entry_items order by id')).rows;await record(f.payload);expect((await db.query('select * from payroll_entry_items order by id')).rows).toEqual(before);});
it('rejects insufficient capacity already assigned to expenses without inserting a payment',async()=>{
 const f=await fixture(),expense=randomUUID();await db.query('insert into finance_expense_items values($1,$2)',[expense,i.tenant]);await db.query('insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values($1,$2,$3,25000,$4)',[i.tenant,expense,f.movement,i.operator]);await expect(record(f.payload)).rejects.toThrow('finance_movement_overallocated');expect(await count('driver_settlement_payments')).toBe(0);
});
it('rejects stale settlement, another tenant and driver including mixed membership',async()=>{
 const f=await fixture();await db.query('update driver_settlements set needs_recalculation=true where id=$1',[f.settlement]);await expect(record(f.payload)).rejects.toThrow('finance_settlement_requires_review');await db.query('update driver_settlements set needs_recalculation=false where id=$1',[f.settlement]);
 await expect(record({...f.payload,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');await expect(record(f.payload,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(record(f.payload)).rejects.toThrow('finance_access_denied');
});
it.each([{amount_cents:0},{amount_cents:1.5},{amount_cents:'30000'},{amount_cents:100000000000000},{method:'wire'},{receipt_url:'https://example.test/a'},{reason:'curto'},{version:'1'}])('rejects invalid command %j',async(patch)=>{const f=await fixture();await expect(record({...f.payload,...patch})).rejects.toThrow('finance_invalid_payload');expect(await count('driver_settlement_payments')).toBe(0);});
it('rejects reuse of request key with changed amount',async()=>{const f=await fixture();await record(f.payload);await expect(record({...f.payload,amount_cents:20000})).rejects.toThrow('finance_request_conflict');expect(await count('driver_settlement_payments')).toBe(1);});



it('cancelled payroll with an actual title payment still requires review',async()=>{
 const f=await fixture(),p=await payroll('cancelled','cancelled');const payable=randomUUID();await db.query("insert into payables(id,tenant_id,supplier_name,description,amount,source_table,source_id) values($1,$2,'Motorista QA','Folha',100,'payroll_entries',$3)",[payable,i.tenant,p.entry]);await db.query('insert into payables_payments(tenant_id,payable_id,amount,bank_account_id) values($1,$2,100,$3)',[i.tenant,payable,i.account]);
 await expect(record(f.payload)).rejects.toThrow('finance_settlement_locked_in_payroll');expect(await count('driver_settlement_payments')).toBe(0);
});
it('overlapping editable payroll entries for the same employee require review before double credit',async()=>{
 const f=await fixture(),first=await payroll();const second=randomUUID();await db.query("insert into payroll_periods(id,tenant_id,period_name,period_start,period_end) values($1,$2,'Sobreposta','2026-01-05','2026-01-20')",[second,i.tenant]);await db.query('insert into payroll_entries(tenant_id,payroll_period_id,employee_id,driver_id) values($1,$2,$3,$4)',[i.tenant,second,first.employee,i.driver]);
 await expect(record(f.payload)).rejects.toThrow('finance_settlement_overlapping_payroll');expect(await count('driver_settlement_payments')).toBe(0);expect(await count('payroll_entry_items')).toBe(3);
});


it.each(['NaN','Infinity','1000000000000'])('rejects debt outside the monetary contract: %s',async(debt)=>{const f=await fixture();await db.query('update driver_settlements set driver_payable_amount=$1::numeric where id=$2',[debt,f.settlement]);await expect(record(f.payload)).rejects.toThrow('finance_settlement_amount_review');expect(await count('driver_settlement_payments')).toBe(0);});
it('a later failure rolls back payment, link, settlement totals, event and payroll append together',async()=>{
 const f=await fixture();await payroll();const before=(await db.query('select * from driver_settlements')).rows;await db.exec("create function public.qa_fail_recompute() returns trigger language plpgsql as $$begin raise exception 'qa_recompute_failure';end$$;create trigger qa_fail_recompute before update on payroll_entries for each row execute function qa_fail_recompute();");
 await expect(record(f.payload)).rejects.toThrow('qa_recompute_failure');expect(await count('driver_settlement_payments')).toBe(0);expect(await count('finance_settlement_movement_links')).toBe(0);expect(await count('payroll_entry_items')).toBe(3);expect(await count('driver_settlement_events')).toBe(0);expect((await db.query('select * from driver_settlements')).rows).toEqual(before);
 expect((await db.query("select * from finance_commands where action='record_settlement_payment'")).rows).toHaveLength(0);
});
