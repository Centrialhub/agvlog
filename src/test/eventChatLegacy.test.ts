// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createEventChatDatabase,eventChatIds as i,legacyEventSend} from './helpers/eventChatDatabase';
import {chatActor} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;beforeAll(async()=>{db=await createEventChatDatabase();});afterAll(()=>db?.close());beforeEach(async()=>{await db.exec('begin');await chatActor(db);});afterEach(()=>db.exec('rollback'));
describe('event chat legacy reproduction',()=>{
 it('accepts sender display names from the caller',async()=>{expect((await legacyEventSend(db,i.event,'driver','Identidade arbitrária')).rows[0].sender_name).toBe('Identidade arbitrária');});
 it('accepts an operator label claiming owner and a tenant/event mismatch',async()=>{await chatActor(db,i.operator);expect((await legacyEventSend(db,i.foreignEvent,'owner')).rows[0]).toMatchObject({tenant_id:i.tenant,event_id:i.foreignEvent,sender_role:'owner'});});
 it('duplicates an otherwise identical retry',async()=>{await legacyEventSend(db);await legacyEventSend(db);expect((await operationRpc(db,'select * from operational_event_messages')).rows).toHaveLength(2);});
 it('keeps driver read and send access after membership revocation',async()=>{await legacyEventSend(db);await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);expect((await operationRpc(db,'select * from operational_event_messages')).rows).toHaveLength(1);await legacyEventSend(db);});
 it('lets the new trip driver read old messages even when the event names the original driver',async()=>{await legacyEventSend(db);await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.peerDriver,i.trip]);await chatActor(db,i.peerUser);expect((await operationRpc(db,'select * from operational_event_messages')).rows).toHaveLength(1);});
 it('negative controls deny an unrelated driver and require MFA for an administrator',async()=>{await expect(legacyEventSend(db,i.peerEvent)).rejects.toThrow('row-level security');await chatActor(db,i.admin);await expect(legacyEventSend(db,i.event,'admin')).rejects.toThrow('row-level security');await chatActor(db,i.admin,'aal2');await legacyEventSend(db,i.event,'admin');});
});
