// @vitest-environment node
import { FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ssxSyncError } from '@/lib/ssxSyncError';

describe('SSX unit synchronization error shown in Settings', () => {
  it('reveals missing identity without relabeling it as rate limiting or consuming the response', async () => {
    const body = { success: false, error_class: 'missing_stable_identity', error: 'Missing code',
      next_sync_available_at: '2026-09-27T10:00:00Z' };
    const response = Response.json(body, { status: 409 });
    const failure = await ssxSyncError(new FunctionsHttpError(response), null);
    expect(failure?.message).toContain('veículos sem o código necessário');
    expect(failure).not.toHaveProperty('cooldownActive');
    expect(failure).not.toHaveProperty('retryAt');
    expect(await response.json()).toEqual(body);
  });

  it('preserves the provider cooldown timestamp hidden in an HTTP error', async () => {
    const retryAt = '2026-09-27T10:00:00Z';
    const response = Response.json({ error: 'Rate limit', cooldown_active: true, retry_at: retryAt }, { status: 429 });
    const failure = await ssxSyncError(new FunctionsHttpError(response), null);
    expect(failure).toMatchObject({ cooldownActive: true, retryAt });
  });

  it.each([
    [401, 'validar sua sessão'], [403, 'não tem permissão'], [429, 'Limite de solicitações'],
  ])('gives HTTP %s priority over conflicting business error details', async (status, message) => {
    const error = new FunctionsHttpError(Response.json({ error_class: 'missing_stable_identity',
      error: 'Missing code', retry_at: '2026-09-27T10:00:00Z' }, { status: Number(status) }));
    const failure = await ssxSyncError(error, null);
    expect(failure?.message).toContain(message);
    expect(failure?.cooldownActive).toBe(status === 429 ? true : undefined);
  });

  it.each([
    [{ message: JSON.stringify({ error: 'Rate limit', retry_at: '2026-09-27T10:00:00Z' }) }, null],
    [{ context: { error: 'Rate limit', cooldown_active: true } }, null],
    [null, { error: 'Rate limit', cooldown_active: true }],
  ])('keeps legacy JSON error responses compatible', async (error, data) => {
    expect(await ssxSyncError(error, data)).toMatchObject({ message: 'Rate limit', cooldownActive: true });
  });

  it.each([
    [401, 'validar sua sessão'],
    [403, 'não tem permissão'],
    [429, 'Limite de solicitações'],
    [502, 'HTTP 502'],
  ])('handles HTTP %s with a non-JSON gateway response', async (status, message) => {
    const error = new FunctionsHttpError(new Response('<html>Gateway</html>', { status: Number(status) }));
    const failure = await ssxSyncError(error, null);
    expect(failure?.message).toContain(message);
    expect(failure?.cooldownActive).toBe(status === 429 ? true : undefined);
  });

  it('does not render invalid retry dates or turn an unconfirmed result into success', async () => {
    const failure = await ssxSyncError(null, { error: 'Rate limit', retry_at: 'invalid' });
    expect(failure?.cooldownActive).toBe(true);
    expect(failure?.retryAt).toBeUndefined();
    expect(await ssxSyncError(null, null)).toBeInstanceOf(Error);
    expect(await ssxSyncError(null, { success: false })).toBeInstanceOf(Error);
  });

  it.each([
    { success: true, upserted: 2 },
    { success: true, upserted: 0 },
    { success: true, skipped: true, reason: 'Units synced recently',
      last_sync_at: '2026-09-27T09:00:00Z', next_sync_available_at: '2026-09-27T10:00:00Z' },
  ])('accepts confirmed fresh or cached success without fabricating an error', async data => {
    expect(await ssxSyncError(null, data)).toBeNull();
  });

  it.each([
    { success: true }, { success: true, upserted: -1 }, { success: true, upserted: 1.5 },
    { success: true, upserted: '2' }, { success: true, skipped: true },
    { success: true, skipped: true, last_sync_at: 'invalid', next_sync_available_at: 'invalid' },
    { success: true, skipped: true, last_sync_at: '2026-09-27T10:00:00Z', next_sync_available_at: '2026-09-27T09:00:00Z' },
  ])('rejects success with an invalid count or unconfirmed cache: %j', async data => {
    expect((await ssxSyncError(null, data))?.message).toContain('sincronização não foi confirmada');
  });
});
