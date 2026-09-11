// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;const settlement=randomUUID(),historical=randomUUID();let originalOids:unknown[];let originalPayments:unknown[];
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['driver_settlements','driver_settlement_payments']){
  const ddl=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!ddl)throw new Error(table);await db.exec(ddl);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);
 }
 for(const name of ['register_driver_settlement_payment','register_driver_settlement_payment_v2']){
  const routine=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!routine)throw new Error(name);await db.exec(routine);
 }
 originalOids=(await db.query("select oid,proname,pg_get_function_arguments(oid) args from pg_proc where proname in('register_driver_settlement_payment','register_driver_settlement_payment_v2') order by proname")).rows;
 // Presence-only stubs isolate retirement behavior. Real replacement is tested separately.
 await db.exec(`create function public.record_finance_settlement_payment(jsonb) returns jsonb language sql as $$select $1$$;
 create function public.get_finance_settlement_payment_candidates(uuid,uuid,bigint,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
 create table finance_settlement_movement_links(id uuid,tenant_id uuid,payment_id uuid,settlement_id uuid,amount_cents bigint);`);
 await db.query('insert into driver_settlements(id,tenant_id,driver_id) values($1,$2,$3)',[settlement,i.tenant,i.driver]);
 await db.query('insert into driver_settlement_payments(id,tenant_id,settlement_id,amount) values($1,$2,$3,100)',[historical,i.tenant,settlement]);
 originalPayments=(await db.query('select * from driver_settlement_payments')).rows;
 await db.exec(readFileSync('supabase/migrations/20260910133700_finance_retire_legacy_settlement_payment_writers.sql','utf8'));
});
afterAll(()=>db.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
it('preserves function identities, defaults and original payments while making legacy routines inert',async()=>{
 expect((await db.query("select oid,proname,pg_get_function_arguments(oid) args from pg_proc where proname in('register_driver_settlement_payment','register_driver_settlement_payment_v2') order by proname")).rows).toEqual(originalOids);
 for(const name of ['register_driver_settlement_payment','register_driver_settlement_payment_v2']){
  await db.exec('savepoint legacy_call');await expect(db.query(`select ${name}($1,10)`,[settlement])).rejects.toThrow('finance_legacy_settlement_writer_retired');await db.exec('rollback to savepoint legacy_call;release savepoint legacy_call');
  await expect(financeAs(db,i.operator,`select ${name}($1,10)`,[settlement])).rejects.toThrow('permission denied');
 }
 expect((await db.query('select * from driver_settlement_payments')).rows).toEqual(originalPayments);
});
it('requires a same-company complete association before a new payment can commit',async()=>{
 const payment=randomUUID();await db.query('insert into driver_settlement_payments(id,tenant_id,settlement_id,amount) values($1,$2,$3,50)',[payment,i.tenant,settlement]);
 await db.exec('savepoint flush');await expect(db.exec('set constraints all immediate')).rejects.toThrow('finance_settlement_payment_requires_recorded_movement');await db.exec('rollback to savepoint flush;release savepoint flush');
 await db.query('insert into finance_settlement_movement_links values($1,$2,$3,$4,5000)',[randomUUID(),i.tenant,payment,settlement]);
 await db.exec('set constraints all immediate');expect((await db.query('select * from driver_settlement_payments')).rows).toHaveLength(2);
});
it('denies direct application writes and keeps even unlinked historical payments immutable',async()=>{
 await expect(financeAs(db,i.operator,'insert into driver_settlement_payments(tenant_id,settlement_id,amount) values($1,$2,10)',[i.tenant,settlement])).rejects.toThrow('permission denied');
 await db.exec('savepoint immutable');await expect(db.query('delete from driver_settlement_payments where id=$1',[historical])).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint immutable;release savepoint immutable');
 expect((await db.query("select has_table_privilege('service_role','driver_settlement_payments','INSERT') allowed")).rows).toEqual([{allowed:false}]);
});
