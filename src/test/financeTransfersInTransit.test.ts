// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;const destination=crypto.randomUUID();
beforeAll(async()=>{db=await createFinanceLedgerDatabase();await db.query('insert into bank_accounts(id,tenant_id,active,name) values($1,$2,true,$3)',[destination,i.tenant,'Destino']);for(const file of ['20260910033918_finance_internal_transfer_pairs.sql','20260910034731_finance_transfers_in_transit.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.exec(readFileSync('supabase/migrations/20260910035550_finance_transfer_period_position.sql','utf8'));});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const depart=(patch:Record<string,unknown>={})=>({version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),stage:'depart',source_account_id:i.account,destination_account_id:destination,amount_cents:50000,occurred_on:'2026-01-01',reason:'Saída já realizada aguardando crédito',occurred:true,...patch});
const arrive=(id:string,patch:Record<string,unknown>={})=>({version:1,tenant_id:i.tenant,request_id:crypto.randomUUID(),stage:'arrive',departure_id:id,occurred_on:'2026-01-02',reason:'Crédito recebido na conta de destino',occurred:true,...patch});
const record=async(p:Record<string,unknown>,actor=i.operator)=>(await financeAs<{result:{departure_id:string;movement_id:string;transfer_id:string|null}}>(db,actor,'select record_finance_transfer_stage($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
const pending=async()=>(await financeAs<{result:{total:number;amount_cents:string;rows:unknown[]}}>(db,i.operator,'select get_finance_pending_transfers($1,1) result',[i.tenant])).rows[0].result;
const position=async(account:string,cutoff:string)=>(await financeAs<{result:{total:number;unlinked_count:number;outbound_transit_cents:string;inbound_transit_cents:string;rows:{status:string}[]}}>(db,i.operator,'select get_finance_transfer_period_position($1,$2,$3,1) result',[i.tenant,account,cutoff])).rows[0].result;
it('preserves month-end transit after a later arrival and clears it only at the arrival cutoff',async()=>{
 const r=await record(depart({occurred_on:'2026-01-31'}));await record(arrive(r.departure_id,{occurred_on:'2026-02-01'}));
 expect(await position(i.account,'2026-01-31')).toMatchObject({total:1,outbound_transit_cents:'50000',inbound_transit_cents:'0',rows:[{status:'arrived_after_cutoff'}]});
 expect(await position(destination,'2026-01-31')).toMatchObject({total:1,outbound_transit_cents:'0',inbound_transit_cents:'50000'});
 expect(await position(destination,'2026-02-01')).toMatchObject({total:0,inbound_transit_cents:'0'});expect((await position(i.account,'2026-01-30')).total).toBe(0);
});
it('does not invent an expected counterparty from an unpaired legacy transfer',async()=>{
 await db.query("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,'out','transfer',700,'2026-01-01','Legado','Destino desconhecido',$3)",[i.tenant,i.account,i.operator]);
 expect(await position(i.account,'2026-01-31')).toMatchObject({total:1,unlinked_count:1,outbound_transit_cents:'0',inbound_transit_cents:'0',rows:[{status:'unlinked_outgoing'}]});
 await expect(position(i.otherAccount,'2026-01-31')).rejects.toThrow('finance_invalid_account');
 await expect(financeAs(db,i.driverUser,'select get_finance_transfer_period_position($1,$2,$3,1)',[i.tenant,i.account,'2026-01-31'])).rejects.toThrow('finance_access_denied');
});
it('leaves destination cash absent until arrival and preserves the original departure after completion',async()=>{
 const p=depart(),r=await record(p);expect(await record(p)).toEqual(r);expect(r.transfer_id).toBeNull();expect(await pending()).toMatchObject({total:1,amount_cents:'50000'});
 expect((await db.query('select direction,amount_cents::text from finance_movements')).rows).toEqual([{direction:'out',amount_cents:'50000'}]);
 const a=arrive(r.departure_id),done=await record(a);expect(await record(a)).toEqual(done);expect(done.transfer_id).toBeTruthy();expect(await pending()).toMatchObject({total:0,amount_cents:'0'});
 expect((await db.query('select outgoing_id,incoming_id from finance_internal_transfers')).rows).toEqual([{outgoing_id:r.movement_id,incoming_id:done.movement_id}]);
 expect((await db.query('select count(*)::int n from finance_transfer_departures')).rows[0]).toEqual({n:1});
 await expect(record(arrive(r.departure_id))).rejects.toThrow('finance_transfer_already_arrived');
});
it('rejects an earlier arrival, changed amounts and another departure scope',async()=>{
 const r=await record(depart());await expect(record(arrive(r.departure_id,{occurred_on:'2025-12-31'}))).rejects.toThrow('finance_transfer_invalid_arrival');
 await expect(record(arrive(r.departure_id,{amount_cents:49900}))).rejects.toThrow('finance_invalid_payload');await expect(record(arrive(crypto.randomUUID()))).rejects.toThrow('finance_transfer_departure_not_found');
 expect((await pending()).total).toBe(1);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
});
it('rolls back a failed arrival without losing the pending departure',async()=>{
 const r=await record(depart());await db.exec("create function qa_fail_pair() returns trigger language plpgsql as $$begin raise exception 'pair_failure';end$$;create trigger qa_fail_pair before insert on finance_internal_transfers for each row execute function qa_fail_pair();");
 await expect(record(arrive(r.departure_id))).rejects.toThrow('pair_failure');expect((await pending()).total).toBe(1);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
});
it('denies drivers and cross-tenant accounts without exposing pending money',async()=>{
 await expect(record(depart(),i.driverUser)).rejects.toThrow('finance_access_denied');await expect(record(depart({destination_account_id:i.otherAccount}))).rejects.toThrow('finance_invalid_account');
 await record(depart());await expect(financeAs(db,i.driverUser,'select get_finance_pending_transfers($1,1)',[i.tenant])).rejects.toThrow('finance_access_denied');
 expect((await financeAs(db,i.driverUser,'select * from finance_transfer_departures')).rows).toEqual([]);
});
