// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventChatDatabase, eventChatIds as ids, eventPayload, eventSend, eventList } from './helpers/eventChatDatabase';
import { chatActor } from './helpers/driverChatDatabase';
import { operationRpc } from './helpers/operationOutcomeDatabase';

const migration = readFileSync('supabase/migrations/20260928182647_remove_redundant_event_message_read_policy.sql', 'utf8');
const noMfa = readFileSync('supabase/migrations/20260831164442_remove_authenticator_requirement.sql', 'utf8');
const legacy = readFileSync('supabase/migrations/20260826165000_require_privileged_mfa.sql', 'utf8');
const legacyPolicy = legacy.match(/CREATE POLICY "Tenant members read event messages"[\s\S]*?;/)?.[0];
if (!legacyPolicy) throw new Error('Missing historical event read policy');

function functionDefinition(qualifiedName: string) {
  const start = noMfa.indexOf('create or replace function ' + qualifiedName + '(');
  if (start < 0) throw new Error('Missing current chat helper ' + qualifiedName);
  const source = noMfa.slice(start);
  const delimiter = /\bas\s+(\$[a-zA-Z0-9_]*\$)/i.exec(source);
  if (!delimiter) throw new Error('Missing function body delimiter');
  const end = source.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error('Missing function body end');
  return source.slice(0, end + delimiter[1].length + 1);
}

let db: PGlite;
beforeAll(async () => {
  db = await createEventChatDatabase(true);
  // Reuse the applied no-MFA definitions, not the older fixture's MFA contract.
  for (const name of ['public.is_tenant_member', 'driver_chat_private.event_can_access', 'driver_chat_private.event_context']) {
    await db.exec(functionDefinition(name));
  }
  await db.exec(legacyPolicy);
});
afterAll(() => db?.close());
beforeEach(async () => {
  await db.exec('begin');
  await chatActor(db, ids.operator);
  for (const event of [ids.event, ids.peerEvent, ids.unassignedEvent]) {
    await eventSend(db, await eventPayload(db, ids.operator, event));
  }
  await db.query(`
    insert into public.operational_event_messages
      (tenant_id,event_id,sender_id,sender_role,sender_name,message,client_request_id,request_hash,conversation_driver_id,conversation_user_id)
    values ($1,$2,$3,'driver','Foreign synthetic driver','Foreign synthetic message',gen_random_uuid(),repeat('a',64),$4,$3)
  `, [ids.otherTenant, ids.foreignEvent, ids.foreignUser, ids.foreignDriver]);
});
afterEach(() => db.exec('rollback'));

async function visibleEvents(actor: string) {
  await chatActor(db, actor);
  const result = await operationRpc<{ event_id: string }>(db,
    'select event_id::text from public.operational_event_messages order by event_id');
  return result.rows.map(row => row.event_id);
}
async function policies() {
  return (await db.query<{ polname: string }>(`
    select polname,polcmd,polpermissive,polroles,
      pg_get_expr(polqual,polrelid) as using_expression,pg_get_expr(polwithcheck,polrelid) as check_expression
    from pg_policy where polrelid='public.operational_event_messages'::regclass order by polname
  `)).rows;
}
async function overlapCount() {
  return (await db.query<{ count: number }>(`
    select count(*)::int from pg_policies where schemaname='public' and tablename='operational_event_messages'
      and permissive='PERMISSIVE' and cmd in ('SELECT','ALL') and 'authenticated'=any(roles)
  `)).rows[0].count;
}

describe('event message legacy SELECT policy consolidation', () => {
  it('removes the overlap while preserving the same allowed and denied rows for every chat audience', async () => {
    const expected = [
      [ids.user, [ids.event]],
      [ids.peerUser, [ids.peerEvent]],
      [ids.operator, [ids.event, ids.peerEvent, ids.unassignedEvent]],
      [ids.admin, [ids.event, ids.peerEvent, ids.unassignedEvent]],
      [ids.client, []],
      [ids.foreignUser, [ids.foreignEvent]],
      ['', []],
    ] as const;
    expect(await overlapCount()).toBe(2);
    for (const [actor, events] of expected) expect(await visibleEvents(actor)).toEqual(events);
    await db.exec(migration);
    expect(await overlapCount()).toBe(1);
    for (const [actor, events] of expected) expect(await visibleEvents(actor)).toEqual(events);
    await chatActor(db, ids.user);
    expect((await eventList(db)).messages).toHaveLength(1);
  });

  it('keeps recipient snapshots and revoked membership restrictions after the cleanup', async () => {
    await db.query('update dispatch_trips set driver_id=$1 where id=$2', [ids.peerDriver, ids.trip]);
    expect(await visibleEvents(ids.peerUser)).toEqual([ids.peerEvent]);
    await db.query('update tenant_memberships set active=false where user_id=$1', [ids.user]);
    expect(await visibleEvents(ids.user)).toEqual([]);
    await db.exec(migration);
    expect(await visibleEvents(ids.peerUser)).toEqual([ids.peerEvent]);
    expect(await visibleEvents(ids.user)).toEqual([]);
    await expect(eventList(db)).rejects.toThrow('not_authorized');
  });

  it('is repeatable and preserves every other policy, table grant, row and caller search path', async () => {
    const beforePolicies = await policies();
    const relation = () => db.query("select relrowsecurity,relforcerowsecurity,relacl from pg_class where oid='public.operational_event_messages'::regclass");
    const rows = () => db.query('select * from public.operational_event_messages order by id');
    const beforeRelation = (await relation()).rows;
    const beforeRows = (await rows()).rows;
    const beforePath = (await db.query('show search_path')).rows;
    await db.exec(migration);
    await db.exec(migration);
    expect(await policies()).toEqual(beforePolicies.filter(p => p.polname !== 'Tenant members read event messages'));
    expect((await relation()).rows).toEqual(beforeRelation);
    expect((await rows()).rows).toEqual(beforeRows);
    expect((await db.query('show search_path')).rows).toEqual(beforePath);
    expect((await db.query<{ can_write: boolean }>(
      "select has_table_privilege('authenticated','public.operational_event_messages','INSERT,UPDATE,DELETE') can_write"
    )).rows[0].can_write).toBe(false);
  });

  it.each([
    ['missing boundary', 'drop policy event_chat_read_boundary on public.operational_event_messages'],
    ['weaker boundary', 'alter policy event_chat_read_boundary on public.operational_event_messages using (true)'],
    ['changed audience', 'alter policy event_chat_read_boundary on public.operational_event_messages to public'],
    ['changed canonical predicate', 'alter policy event_chat_read on public.operational_event_messages using (true)'],
    ['volatile helper', 'alter function driver_chat_private.event_can_read(uuid,uuid,uuid,uuid) volatile'],
    ['changed legacy policy', 'alter policy "Tenant members read event messages" on public.operational_event_messages using (true)'],
  ])('refuses %s and retains the legacy policy for explicit review', async (_name, drift) => {
    await db.exec(drift);
    await db.exec('savepoint consolidation_attempt');
    await expect(db.exec(migration)).rejects.toThrow(/canonical read boundary|Legacy event message read policy changed/);
    await db.exec('rollback to savepoint consolidation_attempt; release savepoint consolidation_attempt');
    expect((await policies()).some(p => p.polname === 'Tenant members read event messages')).toBe(true);
  });
});
