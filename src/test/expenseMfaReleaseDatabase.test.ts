// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {expenseMfaDatabase,expenseMfaActor,expenseMfaRole,expenseMfaSql} from './helpers/expenseMfaDatabase';
import {expenseMfaRelease} from './helpers/expenseMfaRelease';
import {expenseCreationRelease} from './helpers/expenseCreationRelease';
import {manualSettlement,creationCommand,creationPayload,creationContext} from './helpers/expenseCreationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;let legacyDb:PGlite;
beforeAll(async()=>{
 ({db}=await expenseMfaDatabase());
 ({db:legacyDb}=await expenseMfaDatabase(false));
},30000);
afterAll(async()=>{await db?.close();await legacyDb?.close();});
beforeEach(async()=>{await db.exec('begin');await expenseMfaActor(db);});
afterEach(async()=>{await db.exec('rollback');});
describe('MFA-preserving expense containment',()=>{
 it('preserves committed evidence and restores exact replay without restoring AAL1 admin access',async()=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const payload=await creationPayload(db,source,'settlement',i.operator),ack=await creationCommand(db,payload);
  const before=(await db.query('select to_jsonb(e) row from driver_expenses e')).rows;
  await expenseMfaRelease(db,'contain');await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,'select expense_creation_private.create_driver_expense_command($1::jsonb)',[JSON.stringify(payload)])).rejects.toMatchObject({code:'42501'});
  expect((await db.query('select to_jsonb(e) row from driver_expenses e')).rows).toEqual(before);
  await expenseMfaRelease(db,'resume');await expenseMfaActor(db);await expect(creationCommand(db,payload)).rejects.toMatchObject({message:'expense_creation_mfa_required'});
  await expenseMfaActor(db,i.operator,'aal2');expect(await creationCommand(db,payload)).toEqual(ack);
 });
 it('refuses resumption after a private authorization body changes',async()=>{
  await expenseMfaRelease(db,'contain');await db.exec('savepoint changed_body');
  await db.exec("create or replace function expense_creation_private.require_session(_tenant uuid,_actor uuid) returns void language plpgsql stable security invoker set search_path='' as $$begin return;end;$$;");
  await expect(expenseMfaRelease(db,'resume')).rejects.toThrow(/function or grants changed/);
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.create_driver_expense_command(jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
  await db.exec('rollback to savepoint changed_body;release savepoint changed_body');await expenseMfaRelease(db,'resume');
 });
 it('refuses resumption after a restrictive MFA read boundary disappears',async()=>{
  await expenseMfaRelease(db,'contain');await db.exec('drop policy expense_creation_mfa_read on driver_expense_creations');
  await expect(expenseMfaRelease(db,'resume')).rejects.toThrow(/read boundary changed/);
 });
 it('never grants receipt inspection to service_role after resumption',async()=>{
  await expenseMfaRelease(db,'contain');await expenseMfaRelease(db,'resume');
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('service_role','public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
  expect((await creationContext(db,await manualSettlement(db),'settlement')).can_create).toBe(true);
 });
 it('does not use installation as an implicit resume of a contained previous version',async()=>{
  await legacyDb.exec('begin');await expenseCreationRelease(legacyDb,'contain');await legacyDb.exec('savepoint install_mfa');
  await expect(legacyDb.exec(expenseMfaSql())).rejects.toThrow(/release\/grants changed/);
  await legacyDb.exec('rollback to savepoint install_mfa;release savepoint install_mfa');
  expect((await legacyDb.query<{absent:boolean}>("select to_regnamespace('expense_creation_private') is null absent")).rows[0].absent).toBe(true);
  expect((await legacyDb.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.create_driver_expense_command(jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
  await legacyDb.exec('rollback');
 });
});
