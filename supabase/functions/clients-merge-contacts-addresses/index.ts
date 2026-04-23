import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ContactSnapshot { phone?: string; name?: string; email?: string }
interface AddressSnapshot { street?: string; number?: string; neighborhood?: string; city?: string; state?: string; zip?: string }

const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
const norm = (v: string) => (v || '').trim().toLowerCase();

function contactKey(c: ContactSnapshot): string {
  const phone = onlyDigits(c.phone || '');
  if (phone) return `phone:${phone}`;
  const email = norm(c.email || '');
  if (email) return `email:${email}`;
  return `name:${norm(c.name || '')}`;
}

function addressKey(a: AddressSnapshot): string {
  const zip = onlyDigits(a.zip || '');
  const num = norm(a.number || '');
  if (zip) return `zip:${zip}|num:${num}`;
  const street = norm(a.street || '');
  const city = norm(a.city || '');
  if (street) return `street:${street}|num:${num}|city:${city}`;
  return '';
}

function dedupeContacts(list: ContactSnapshot[]): ContactSnapshot[] {
  const seen = new Map<string, ContactSnapshot>();
  for (const c of list) {
    if (!c || (typeof c !== 'object')) continue;
    const k = contactKey(c);
    if (!k || k === 'name:') continue;
    if (!seen.has(k)) seen.set(k, c);
    else {
      const merged = { ...seen.get(k)!, ...Object.fromEntries(Object.entries(c).filter(([, v]) => !!v)) };
      seen.set(k, merged);
    }
  }
  return Array.from(seen.values());
}

function dedupeAddresses(list: AddressSnapshot[]): AddressSnapshot[] {
  const seen = new Map<string, AddressSnapshot>();
  for (const a of list) {
    if (!a || (typeof a !== 'object')) continue;
    const k = addressKey(a);
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, a);
    else {
      const merged = { ...seen.get(k)!, ...Object.fromEntries(Object.entries(a).filter(([, v]) => !!v)) };
      seen.set(k, merged);
    }
  }
  return Array.from(seen.values());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Validate caller
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const clientId: string | undefined = body.client_id;
    const newContacts: ContactSnapshot[] = Array.isArray(body.contacts) ? body.contacts : [];
    const newAddresses: AddressSnapshot[] = Array.isArray(body.addresses) ? body.addresses : [];

    if (!clientId || typeof clientId !== 'string') {
      return new Response(JSON.stringify({ error: 'client_id is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (newContacts.length === 0 && newAddresses.length === 0) {
      return new Response(JSON.stringify({ error: 'Provide at least one contact or address' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Service-role client for atomic read-merge-write with tenant guard
    const admin = createClient(supabaseUrl, serviceKey);

    // Optimistic concurrency: re-read & write up to 3 times if updated_at changes
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data: client, error: readErr } = await admin
        .from('clients')
        .select('id, tenant_id, contacts, addresses, updated_at')
        .eq('id', clientId)
        .maybeSingle();

      if (readErr) throw readErr;
      if (!client) {
        return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Verify caller belongs to client tenant
      const { data: membership } = await admin
        .from('tenant_memberships')
        .select('id')
        .eq('user_id', userData.user.id)
        .eq('tenant_id', client.tenant_id)
        .eq('active', true)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const existingContacts: ContactSnapshot[] = Array.isArray(client.contacts) ? client.contacts as any : [];
      const existingAddresses: AddressSnapshot[] = Array.isArray(client.addresses) ? client.addresses as any : [];

      const mergedContacts = dedupeContacts([...existingContacts, ...newContacts]);
      const mergedAddresses = dedupeAddresses([...existingAddresses, ...newAddresses]);

      const addedContacts = mergedContacts.length - existingContacts.length;
      const addedAddresses = mergedAddresses.length - existingAddresses.length;

      // Conditional write: only update if updated_at hasn't changed (optimistic lock)
      const { data: updated, error: writeErr } = await admin
        .from('clients')
        .update({ contacts: mergedContacts, addresses: mergedAddresses, updated_by: userData.user.id })
        .eq('id', clientId)
        .eq('updated_at', client.updated_at)
        .select('id, contacts, addresses, updated_at')
        .maybeSingle();

      if (writeErr) throw writeErr;

      if (updated) {
        return new Response(JSON.stringify({
          ok: true,
          client_id: clientId,
          added_contacts: Math.max(0, addedContacts),
          added_addresses: Math.max(0, addedAddresses),
          contacts_count: mergedContacts.length,
          addresses_count: mergedAddresses.length,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Conflict — retry
      if (attempt === MAX_ATTEMPTS) {
        return new Response(JSON.stringify({ error: 'Concurrent update conflict, please retry' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ error: 'Unknown failure' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('clients-merge-contacts-addresses error', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});