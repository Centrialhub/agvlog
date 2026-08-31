// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {chatActor,chatIds as i,createDriverChatDatabase,legacyChatSend} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createDriverChatDatabase(false);});afterAll(()=>db?.close());
beforeEach(async()=>{await db.exec('begin');await chatActor(db);});afterEach(()=>db.exec('rollback'));
describe('actual consolidated chat RLS and legacy insert',()=>{
 it('accepts an arbitrary sender display name supplied by a driver',async()=>{
  const r=await legacyChatSend(db,{name:'Nome de outra pessoa'});expect(r.rows[0].sender_name).toBe('Nome de outra pessoa');
 });
 it('lets an operator label their message as owner without granting owner privileges',async()=>{
  await chatActor(db,i.operator);const r=await legacyChatSend(db,{role:'owner'});expect(r.rows[0].sender_role).toBe('owner');
 });
 it('accepts a mismatched driver/tenant pair from an internal operator',async()=>{
  await chatActor(db,i.operator);const r=await legacyChatSend(db,{driver:i.foreignDriver,role:'operator'});expect(r.rows[0]).toMatchObject({tenant_id:i.tenant,driver_id:i.foreignDriver});
 });
 it('duplicates the message when the user retries a lost response',async()=>{
  await legacyChatSend(db);await legacyChatSend(db);expect((await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n).toBe(2);
 });
 it('keeps access through an active driver profile after membership revocation',async()=>{
  await legacyChatSend(db);await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);
  expect((await operationRpc(db,'select * from driver_direct_messages')).rows).toHaveLength(1);await legacyChatSend(db);
 });
 it('already refuses another driver conversation and a driver claiming operator role',async()=>{
  await expect(legacyChatSend(db,{driver:i.peerDriver})).rejects.toThrow('row-level security');await expect(legacyChatSend(db,{role:'operator'})).rejects.toThrow('row-level security');
 });
 it('already enforces privileged MFA for the internal role branch',async()=>{
  await chatActor(db,i.admin);await expect(legacyChatSend(db,{role:'admin'})).rejects.toThrow('row-level security');
  await chatActor(db,i.admin,'aal2');await legacyChatSend(db,{role:'admin'});
 });
});
