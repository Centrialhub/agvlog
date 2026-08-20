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

  if (!signature || !timestamp || !deliveryId) return new Response('Missing security headers', { status: 401 });

  // Validate timestamp (accepts both Unix seconds and ISO-8601)
  let ts: number;
  if (timestamp.includes('T') || timestamp.includes('-')) {
    ts = Math.floor(new Date(timestamp).getTime() / 1000);
  } else {
    ts = parseInt(timestamp, 10);
  }

  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return new Response('Timestamp expired or invalid', { status: 401 });
  }

  if (!(await verifyHmac(timestamp, rawBody, signature))) return new Response('Invalid signature', { status: 401 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: existing } = await admin.from('fiscal_webhook_inbox')
    .select('status')
    .eq('delivery_id', deliveryId)
    .maybeSingle();

  if (existing && existing.status === 'processed') return new Response('OK', { status: 200 });

  const payload = JSON.parse(rawBody);
  const { data: inbox, error } = await admin.from('fiscal_webhook_inbox').upsert({
    delivery_id: deliveryId,
    event_type: eventType,
    event_timestamp: new Date(ts * 1000).toISOString(),
    raw_payload: payload,
    status: 'received'
  }).select().single();

  if (error) return new Response('Inbox persistence error', { status: 500 });

  // Reconcile logic (Requirement 3)
  const doc = payload?.document || payload || {};
  const hubId = doc.id || doc.hubDocumentId;
  const idIntegracao = doc.idIntegracao;

  const { data: emission } = await admin.from('hub_fiscal_emissions')
    .select('id, tenant_id')
    .or(`hub_document_id.eq.${hubId},id_integracao.eq.${idIntegracao}`)
    .maybeSingle();

  if (emission) {
    await admin.from('fiscal_webhook_inbox').update({
      tenant_id: emission.tenant_id,
      emission_id: emission.id,
      status: 'processing'
    }).eq('id', inbox.id);
    
    // In a real implementation, a background worker or a direct call would finish the processing.
    // Here we mark as processing to signal it was matched.
  } else {
    await admin.from('fiscal_webhook_inbox').update({ status: 'unmatched' }).eq('id', inbox.id);
  }

  return new Response('OK', { status: 200 });
});
