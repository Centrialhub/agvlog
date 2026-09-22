// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createFinanceLedgerDatabase>>;
const center=randomUUID(),inactive=randomUUID(),foreign=randomUUID();
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`create table public.cost_centers(id uuid primary key,tenant_id uuid not null,name text not null,active boolean not null,unique(tenant_id,id));
 create view finance_private.active_movements as select * from public.finance_movements;`);
 await db.exec(readFileSync('supabase/migrations/20260922214653_finance_movement_cost_center.sql','utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('begin');
 await db.query("insert into cost_centers values($1,$2,'Manutenção',true),($3,$2,'Inativo',false),($4,$5,'Outra empresa',true)",[center,i.tenant,inactive,foreign,i.otherTenant]);
});
afterEach(async()=>{await db.exec('rollback');});
const command=(patch:Record<string,unknown>={})=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:5000,occurred_on:'2026-09-01',description:'Manutenção do veículo',beneficiary_name:'Oficina',reason:'Pagamento conferido',cost_center_id:center,...patch});
const record=async(c=command(),actor=i.operator)=>(await financeAs<{result:Record<string,unknown>}>(db,actor,'select public.record_finance_movement($1) result',[c])).rows[0].result;
it('persists the same cost center on the movement, audit and response, preserving its original name',async()=>{
 const c=command(),result=await record(c);
 expect(result).toMatchObject({cost_center_id:center,cost_center_name:'Manutenção',confirmed:true});
 expect((await db.query('select cost_center_id,cost_center_name from finance_movements')).rows).toEqual([{cost_center_id:center,cost_center_name:'Manutenção'}]);
 expect((await db.query("select after_data->>'cost_center_id' center from finance_events")).rows[0]).toEqual({center});
 await db.query("update cost_centers set name='Novo nome',active=false where id=$1",[center]);
 expect(await record(c)).toEqual(result);
 expect((await db.query('select cost_center_name from finance_movements')).rows[0]).toEqual({cost_center_name:'Manutenção'});
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
});
it('rejects inactive, missing and foreign centers without creating a movement',async()=>{
 for(const id of [inactive,foreign,randomUUID()])await expect(record(command({cost_center_id:id}))).rejects.toThrow('finance_invalid_cost_center');
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
});
it('keeps commands without a center compatible and rejects a changed center on replay',async()=>{
 const c=command();delete (c as Record<string,unknown>).cost_center_id;
 expect(await record(c)).toMatchObject({cost_center_id:null,cost_center_name:null});
 await expect(record({...c,cost_center_id:center})).rejects.toThrow('finance_request_conflict');
});
it('preserves financial access rules and prevents deleting a referenced center',async()=>{
 await expect(record(command(),i.driverUser)).rejects.toThrow('finance_access_denied');
 await record();await db.exec('savepoint deletion');
 await expect(db.query('delete from cost_centers where id=$1',[center])).rejects.toThrow('finance_movements_cost_center_fkey');
 await db.exec('rollback to savepoint deletion');
 await expect(financeAs(db,i.operator,'update finance_movements set cost_center_id=null')).rejects.toThrow('permission denied');
});
