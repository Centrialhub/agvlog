// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {installPasswordSessionFixture,passwordSessionDefinitions} from './helpers/passwordSessionDatabase';
import {manualSettlement,creationPayload,creationCommand} from './helpers/expenseCreationDatabase';
import {adjustmentActor,adjustmentPayload,adjustmentCommand} from './helpers/settlementAdjustmentDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {createEventChatDatabase,eventChatIds as c,eventContext,eventPayload,eventSend} from './helpers/eventChatDatabase';
import {chatActor,chatPayload,chatSend,chatList} from './helpers/driverChatDatabase';

describe('password sessions retain tenant and financial authorization',()=>{
 let db:PGlite;
 beforeAll(async()=>{({db}=await sessionReadersDatabase());await installPasswordSessionFixture(db);},30000);
 afterAll(async()=>{await db?.close();});
 beforeEach(async()=>{await db.exec('begin');await adjustmentActor(db);});
 afterEach(async()=>{await db.exec('rollback');});
 it.each(['owner','admin'])('allows %s to create an expense and replay the same command at AAL1',async role=>{
  await expenseMfaRole(db,role);const source=await manualSettlement(db),payload=await creationPayload(db,source,'settlement',i.operator);
  const result=await creationCommand(db,payload);expect(result.confirmed).toBe(true);
  expect(await creationCommand(db,payload)).toEqual(result);
  expect((await db.query('select id from driver_expenses')).rows).toHaveLength(1);
 });
 it.each(['owner','admin'])('allows %s adjustments without MFA while retaining audit and idempotency',async role=>{
  await expenseMfaRole(db,role);const source=await manualSettlement(db),payload=await adjustmentPayload(db,source);
  const result=await adjustmentCommand(db,payload);expect(result.confirmed).toBe(true);
  expect(await adjustmentCommand(db,payload)).toEqual(result);
  expect((await db.query('select id from driver_settlement_adjustments')).rows).toHaveLength(1);
 });
 it.each(['owner','admin'])('accepts %s password sessions even without an aal claim',async role=>{
  await expenseMfaRole(db,role);await adjustmentActor(db,i.operator,null);
  const source=await manualSettlement(db);expect((await adjustmentCommand(db,await adjustmentPayload(db,source))).confirmed).toBe(true);
 });
 it('denies a forged actor, a different tenant, revoked membership and anonymous claims',async()=>{
  await expenseMfaRole(db,'admin');const source=await manualSettlement(db),payload=await creationPayload(db,source,'settlement',i.operator);
  await expect(creationCommand(db,{...payload,actor_id:i.user})).rejects.toMatchObject({code:'42501'});
  await expect(creationCommand(db,{...payload,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});
  expect((await db.query('select id from driver_expenses')).rows).toHaveLength(0);
 });
 it.each(['driver','client'])('does not let %s gain administrative powers through editable metadata',async role=>{
  await expenseMfaRole(db,role);await adjustmentActor(db,i.operator,'aal1',{user_metadata:{role:'owner',aal:'aal2'}});
  const source=await manualSettlement(db);
  await expect(adjustmentPayload(db,source)).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,'select list_driver_settlements($1)',[i.tenant])).rejects.toThrow('forbidden');
 });
});

describe('password sessions retain chat audience restrictions',()=>{
 let db:PGlite;
 beforeAll(async()=>{db=await createEventChatDatabase(true);await installPasswordSessionFixture(db);},30000);
 afterAll(async()=>{await db?.close();});
 beforeEach(async()=>{await db.exec('begin');await chatActor(db,c.admin);});
 afterEach(async()=>{await db.exec('rollback');});
 it.each(['owner','admin'])('allows %s direct and event chat without MFA',async role=>{
  await db.query('update tenant_memberships set role=$1 where user_id=$2',[role,c.admin]);
  const payload=await chatPayload(db,c.admin);const result=await chatSend(db,payload);
  expect(result.confirmed).toBe(true);expect(await chatSend(db,payload)).toEqual(result);
  expect((await chatList(db)).messages).toHaveLength(1);
  expect((await eventContext(db)).can_send).toBe(true);
  const event=await eventPayload(db,c.admin);expect((await eventSend(db,event)).confirmed).toBe(true);
 });
 it('still denies other tenants, clients and revoked administrators',async()=>{
  await expect(chatList(db,c.foreignDriver)).rejects.toMatchObject({code:'42501'});
  await chatActor(db,c.client);await expect(chatList(db)).rejects.toMatchObject({code:'42501'});
  await chatActor(db,c.admin);await db.query('update tenant_memberships set active=false where user_id=$1',[c.admin]);
  await expect(chatList(db)).rejects.toMatchObject({code:'42501'});await expect(eventContext(db)).rejects.toMatchObject({code:'42501'});
 });
});

it('keeps every latest application function free of a mandatory second-factor check',()=>{
 const latest=new Map<string,string>();
 for(const file of readdirSync('supabase/migrations').sort()){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');
  for(const match of sql.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\([\s\S]*?\bas\s+(\$[A-Za-z_]*\$)[\s\S]*?\2;/gi))latest.set(match[1],match[0]);
 }
 latest.delete('public.session_has_privileged_mfa_v1');
 expect([...latest].filter(([,sql])=>/\baal2\b/i.test(sql)).map(([name])=>name)).toEqual([]);
 expect(passwordSessionDefinitions).toHaveLength(17);
});
