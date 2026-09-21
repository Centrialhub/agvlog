// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatActor, chatContext, chatIds, chatList } from './helpers/driverChatDatabase';
import { createEventChatDatabase, eventContext, eventList } from './helpers/eventChatDatabase';

let db: PGlite;

beforeAll(async () => {
  db = await createEventChatDatabase(true);
  await db.exec(readFileSync(
    'supabase/migrations/20260921165707_restore_password_auth_chat_after_recovery.sql',
    'utf8',
  ));
});

afterAll(() => db?.close());
beforeEach(() => db.exec('begin'));
afterEach(() => db.exec('rollback'));

describe('password-auth chat recovery', { timeout: 15_000 }, () => {
  it('lets an AAL1 administrator read direct and event chat after the recovery migrations', async () => {
    await chatActor(db, chatIds.admin, 'aal1');

    await expect(chatContext(db)).resolves.toMatchObject({ sender_role: 'admin' });
    await expect(chatList(db)).resolves.toMatchObject({ messages: [] });
    await expect(eventContext(db)).resolves.toMatchObject({ audience: 'driver' });
    await expect(eventList(db)).resolves.toMatchObject({ messages: [] });
  });

  it('retains role and authenticated-session boundaries without any AAL2 helper', async () => {
    await chatActor(db, chatIds.client, 'aal1');
    await expect(chatContext(db)).rejects.toThrow('not_authorized');
    await expect(eventContext(db)).rejects.toThrow('not_authorized');

    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
    await expect(chatContext(db)).rejects.toThrow('not_authorized');
    await expect(eventContext(db)).rejects.toThrow('not_authorized');

    const functions = await db.query<{ source: string }>(`
      select procedure.prosrc as source
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'driver_chat_private'
    `);
    expect(functions.rows.map((row) => row.source).join('\n')).not.toMatch(/aal2|session_has_privileged_mfa_v1/i);
  });
});
