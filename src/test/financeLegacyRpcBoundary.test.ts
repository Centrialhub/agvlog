// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;let originalOid:number;
beforeAll(async()=>{
  db=await createFinanceLedgerDatabase();
  await db.exec(`create table public.payables(id uuid primary key,tenant_id uuid,amount integer);
    create function public.list_driver_settlements(_tenant_id uuid,_page integer default 1) returns jsonb language plpgsql security definer as $$declare result jsonb:=jsonb_build_object('page',_page);begin return result;end$$;
    create function public.create_manual_expense(_payload jsonb) returns uuid language plpgsql security definer as $$declare result uuid;begin insert into public.payables values(gen_random_uuid(),(_payload->>'tenant_id')::uuid,10) returning id into result;return result;end;$$;
    create function public.register_payable_payment(_payable_id uuid) returns integer language plpgsql security definer as $$begin update public.payables set amount=0 where id=_payable_id;return 1;end;$$;
    create function public._build_driver_settlement(_tenant_id uuid) returns text language plpgsql security definer as $$begin return 'operational build preserved';end;$$;
    create schema expense_creation_private;grant usage on schema expense_creation_private to authenticated;
    create function expense_creation_private.get_expense_creation_context(_tenant_id uuid) returns jsonb language plpgsql security definer as $$begin return '{"allowed":true}'::jsonb;end;$$;
    grant execute on function expense_creation_private.get_expense_creation_context(uuid) to authenticated;
    create function public.get_expense_creation_context(_tenant_id uuid) returns jsonb language sql security invoker as $$select expense_creation_private.get_expense_creation_context(_tenant_id);$$;
    grant execute on all functions in schema public to authenticated;`);
  originalOid=(await db.query<{oid:number}>("select 'list_driver_settlements(uuid,integer)'::regprocedure::oid oid")).rows[0].oid;
  await db.exec(readFileSync('supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('guard financial RPC entry without replacing operational builders',()=>{
  it('preserves OID, defaults and result while denying driver and other-tenant reads',async()=>{
    expect((await db.query<{oid:number}>("select 'list_driver_settlements(uuid,integer)'::regprocedure::oid oid")).rows[0].oid).toBe(originalOid);
    expect((await financeAs<{result:{page:number}}>(db,i.operator,'select list_driver_settlements($1) result',[i.tenant])).rows[0].result).toEqual({page:1});
    await expect(financeAs(db,i.driverUser,'select list_driver_settlements($1)',[i.tenant])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select list_driver_settlements($1)',[i.otherTenant])).rejects.toThrow('finance_access_denied');
  });
  it('guards payload and entity-ID writes even for mixed internal/driver users',async()=>{
    await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.driverUser]);
    await expect(financeAs(db,i.driverUser,'select create_manual_expense($1::jsonb)',[JSON.stringify({tenant_id:i.tenant})])).rejects.toThrow('finance_access_denied');
    const created=(await financeAs<{id:string}>(db,i.operator,'select create_manual_expense($1::jsonb) id',[JSON.stringify({tenant_id:i.tenant})])).rows[0].id;
    await expect(financeAs(db,i.driverUser,'select register_payable_payment($1)',[created])).rejects.toThrow('finance_access_denied');
    expect((await db.query<{amount:number}>('select amount from payables where id=$1',[created])).rows[0].amount).toBe(10);
    await financeAs(db,i.operator,'select register_payable_payment($1)',[created]);
    expect((await db.query<{amount:number}>('select amount from payables where id=$1',[created])).rows[0].amount).toBe(0);
  });
  it('leaves the operational settlement builder intact',async()=>{
    expect((await financeAs<{result:string}>(db,i.driverUser,'select _build_driver_settlement($1) result',[i.tenant])).rows[0].result).toBe('operational build preserved');
  });
  it('guards the private implementation behind a hardened SQL invoker adapter',async()=>{
    await expect(financeAs(db,i.driverUser,'select get_expense_creation_context($1)',[i.tenant])).rejects.toThrow('finance_access_denied');
    expect((await financeAs<{result:{allowed:boolean}}>(db,i.operator,'select get_expense_creation_context($1) result',[i.tenant])).rows[0].result.allowed).toBe(true);
  });
});
