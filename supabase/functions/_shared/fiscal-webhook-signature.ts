const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;
const SIGNATURE_PREFIX = 'sha256=';

export type FiscalWebhookSignatureError =
  | 'missing_signature'
  | 'invalid_signature'
  | 'invalid_timestamp'
  | 'stale_timestamp';

export interface FiscalWebhookSignatureResult {
  ok: boolean;
  error?: FiscalWebhookSignatureError;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Verifies the Hub Fiscal callback contract against the untouched HTTP body. */
export async function verifyHubFiscalWebhookSignature(input: {
  secret: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  now?: number;
}): Promise<FiscalWebhookSignatureResult> {
  const signature = input.signature.trim().toLowerCase();
  if (!signature.startsWith(SIGNATURE_PREFIX)) return { ok: false, error: 'missing_signature' };

  const received = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(received)) return { ok: false, error: 'invalid_signature' };

  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) return { ok: false, error: 'invalid_timestamp' };
  if (Math.abs((input.now ?? Date.now()) - timestampMs) > MAX_WEBHOOK_AGE_MS) {
    return { ok: false, error: 'stale_timestamp' };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${input.timestamp}.${input.rawBody}`),
  );
  return constantTimeEqual(hex(digest), received)
    ? { ok: true }
    : { ok: false, error: 'invalid_signature' };
}
