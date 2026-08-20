import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function verifyHmac(timestamp: string, body: string, signature: string) {
  const secret = Deno.env.get('HUB_FISCAL_WEBHOOK_HMAC_SECRET');
  if (!secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );

  const data = encoder.encode(`${timestamp}.${body}`);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, data);
  const sigArray = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const expected = `sha256=${sigHex}`;
  // Timing safe comparison
  if (signature.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get('x-hubfiscal-signature') || '';
  const timestamp = req.headers.get('x-hubfiscal-timestamp') || '';
  const deliveryId = req.headers.get('x-hubfiscal-delivery') || '';
  const eventType = req.headers.get('x-hubfiscal-event') || '';

  // 1. Security Gates
  if (!signature || !timestamp || !deliveryId) return new Response('Missing headers', { status: 401 });

  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return new Response('Timestamp expired', { status: 401 });

  const isValid = await verifyHmac(timestamp, rawBody, signature);
  if (!isValid) return new Response('Invalid signature', { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 2. Inbox Idempotency
  const { data: existing } = await admin.from('fiscal_webhook_inbox')
    .select('status')
    .eq('delivery_id', deliveryId)
    .maybeSingle();

  if (existing && existing.status === 'processed') {
    return new Response('Already processed', { status: 200 });
  }

  // 3. Record in Inbox
  const { data: inbox, error: insErr } = await admin.from('fiscal_webhook_inbox').upsert({
    delivery_id: deliveryId,
    event_type: eventType,
    event_timestamp: new Date(ts * 1000).toISOString(),
    raw_payload: JSON.parse(rawBody),
    status: 'received'
  }).select().single();

  if (insErr) return new Response('Inbox failure', { status: 500 });

  // 4. Trigger Processing (simplified)
  // ... actual emission update logic here ...

  return new Response('OK', { status: 200 });
});
