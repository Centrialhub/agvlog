// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;const destination=crypto.randomUUID();
beforeAll(async()=>{db=await createFinanceLedgerDatabase();await db.query('insert into bank_accounts(id,tenant_id,active,name) values($1,$2,true,$3)',[destination,i.tenant,'Banco destino']);await db.exec(readFileSync('supabase/migrations/20260910033918_finance_internal_transfer_pairs.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const payload=(patch:Record<string,unknown>={})=>({version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),source_account_id:i.account,destination_account_id:destination,amount_cents:50000,debited_on:'2026-01-01',credited_on:'2026-01-02',reason:'Transferência já realizada entre contas próprias',both_recorded:true,...patch});
const record=async(p=payload(),actor=i.operator)=>(await financeAs<{result:{outgoing_id:string;incoming_id:string;transfer_id:string;bank_confirmed:false}}>(db,actor,'select record_finance_internal_transfer($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
it('records two equal sides once without revenue, expense or bank confirmation',async()=>{
 const p=payload(),r=await record(p);expect(await record(p)).toEqual(r);expect(r.bank_confirmed).toBe(false);
 expect((await db.query('select direction,nature,amount_cents::text,occurred_on::text from finance_movements order by occurred_on')).rows).toEqual([{direction:'out',nature:'transfer',amount_cents:'50000',occurred_on:'2026-01-01'},{direction:'in',nature:'transfer',amount_cents:'50000',occurred_on:'2026-01-02'}]);
 expect((await db.query('select count(*)::int n from finance_commands')).rows[0]).toEqual({n:1});expect((await db.query('select actor_name from finance_events')).rows).toEqual([{actor_name:'Financeiro QA'}]);
 await expect(record({...p,amount_cents:60000})).rejects.toThrow('finance_request_conflict');
});
it.each([{destination_account_id:i.account},{destination_account_id:i.otherAccount},{amount_cents:0},{amount_cents:1.1},{credited_on:'2025-12-31'},{both_recorded:false}])('rejects invalid transfer %j atomically',async patch=>{
 await expect(record(payload(patch))).rejects.toThrow();expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
});
it('denies drivers, mixed roles and cross-tenant history',async()=>{
 await record();await expect(record(payload(),i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);
 await expect(record(payload(),i.driverUser)).rejects.toThrow('finance_access_denied');expect((await financeAs(db,i.driverUser,'select * from finance_internal_transfers')).rows).toEqual([]);
 await expect(record(payload({tenant_id:i.otherTenant}))).rejects.toThrow('finance_access_denied');
});
it('rejects duplicate bank references and rolls back a late failure of either side',async()=>{
 await record(payload({source_reference:'PIX-TRANSFER'}));await expect(record(payload({source_reference:'PIX-TRANSFER'}))).rejects.toThrow('finance_reference_already_recorded');
 await db.exec("create function qa_fail_transfer_credit() returns trigger language plpgsql as $$begin if new.direction='in' then raise exception 'qa_credit_failure';end if;return new;end$$;create trigger qa_fail_transfer_credit before insert on finance_movements for each row execute function qa_fail_transfer_credit();");
 await expect(record()).rejects.toThrow('qa_credit_failure');expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:2});expect((await db.query('select count(*)::int n from finance_internal_transfers')).rows[0]).toEqual({n:1});
});
it('refuses new unpaired transfers through the old single movement command',async()=>{
 const p={version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),bank_account_id:i.account,direction:'out',nature:'transfer',amount_cents:50000,occurred_on:'2026-01-01',description:'Transferência',beneficiary_name:'Conta própria',reason:'Transferência sem contraparte'};
 await expect(financeAs(db,i.operator,'select record_finance_movement($1::jsonb)',[JSON.stringify(p)])).rejects.toThrow('finance_transfer_pair_required');
});
