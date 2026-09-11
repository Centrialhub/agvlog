// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{
  db=await createFinanceLedgerDatabase();
  await db.exec(`create table driver_expenses(id uuid primary key default gen_random_uuid(),tenant_id uuid,description text);alter table driver_expenses enable row level security;
    grant select,insert,update,delete on driver_expenses to authenticated;create policy old_driver_own_access on driver_expenses for all to authenticated using(true) with check(true);
    create table payroll_entry_items(id uuid primary key default gen_random_uuid(),tenant_id uuid,locked boolean);alter table payroll_entry_items enable row level security;
    grant select,update on payroll_entry_items to authenticated;create policy old_payroll_read on payroll_entry_items for select to authenticated using(true);
    create policy old_payroll_update on payroll_entry_items for update to authenticated using(not locked) with check(not locked);`);
  await db.query("insert into driver_expenses(tenant_id,description) values($1,'Despesa própria')",[i.tenant]);
  await db.query('insert into payroll_entry_items(tenant_id,locked) values($1,true)',[i.tenant]);
  await db.exec(readFileSync('supabase/migrations/20260909234654_finance_legacy_driver_boundary.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('legacy financial restrictive driver boundary',()=>{
  it('overrides legacy own-expense access and rejects driver insertion',async()=>{
    expect((await financeAs(db,i.driverUser,'select * from driver_expenses')).rows).toHaveLength(0);
    await expect(financeAs(db,i.driverUser,"insert into driver_expenses(tenant_id,description) values($1,'tentativa')",[i.tenant])).rejects.toThrow('row-level security');
    expect((await financeAs(db,i.driverUser,'select * from payroll_entry_items')).rows).toHaveLength(0);
  });
  it('denies mixed driver/admin accounts and drivers linked without an active driver membership',async()=>{
    await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.driverUser]);
    expect((await financeAs(db,i.driverUser,'select * from driver_expenses')).rows).toHaveLength(0);
    await db.query("update tenant_memberships set active=false where tenant_id=$1 and user_id=$2 and role='driver'",[i.tenant,i.driverUser]);
    expect((await financeAs(db,i.driverUser,'select * from driver_expenses')).rows).toHaveLength(0);
  });
  it('preserves internal access without relaxing existing locked-payroll restrictions',async()=>{
    expect((await financeAs(db,i.operator,'select * from driver_expenses')).rows).toHaveLength(1);
    expect((await financeAs(db,i.operator,'update payroll_entry_items set locked=false returning id')).rows).toHaveLength(0);
    expect((await financeAs(db,i.operator,'select * from payroll_entry_items')).rows).toHaveLength(1);
  });
});
