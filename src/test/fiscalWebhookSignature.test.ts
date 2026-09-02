import { describe, expect, it } from 'vitest';
import { verifyHubFiscalWebhookSignature } from '../../supabase/functions/_shared/fiscal-webhook-signature';

async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const value = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `sha256=${value}`;
}

describe('Hub Fiscal callback signature', () => {
  const secret = 'callback-secret';
  const timestamp = '2026-09-01T15:00:00.000Z';
  const now = Date.parse(timestamp);
  const rawBody = '{"event":"fiscal_document.updated","document":{"status":"authorized"}}';

  it('validates HMAC-SHA256 over timestamp dot raw body', async () => {
    const signature = await sign(secret, timestamp, rawBody);
    await expect(verifyHubFiscalWebhookSignature({ secret, timestamp, rawBody, signature, now }))
      .resolves.toEqual({ ok: true });
  });

  it('rejects a body changed after signing', async () => {
    const signature = await sign(secret, timestamp, rawBody);
    await expect(verifyHubFiscalWebhookSignature({
      secret,
      timestamp,
      rawBody: `${rawBody} `,
      signature,
      now,
    })).resolves.toEqual({ ok: false, error: 'invalid_signature' });
  });

  it('rejects callbacks outside the five-minute replay window', async () => {
    const signature = await sign(secret, timestamp, rawBody);
    await expect(verifyHubFiscalWebhookSignature({
      secret,
      timestamp,
      rawBody,
      signature,
      now: now + 5 * 60 * 1000 + 1,
    })).resolves.toEqual({ ok: false, error: 'stale_timestamp' });
  });
});
