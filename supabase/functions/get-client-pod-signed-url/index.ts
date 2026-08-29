import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsErr } = await authClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = claims.claims.sub;

    const body = await req.json().catch(() => ({}));
    const { tenant_id, pod_id } = body || {};
    if (!tenant_id || !pod_id) {
      return new Response(JSON.stringify({ error: 'tenant_id and pod_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userClient = authClient;

    // 1) Authorize first. The SECURITY DEFINER RPC returns Storage metadata
    // only when this portal user can download the linked fiscal document.
    const { data: metadataRows, error: metadataErr } = await userClient.rpc(
      'get_client_pod_metadata',
      { _tenant_id: tenant_id, _pod_id: pod_id },
    );
    const metadata = Array.isArray(metadataRows) ? metadataRows[0] : metadataRows;
    if (metadataErr || !metadata?.storage_path) {
      return new Response(JSON.stringify({ error: 'POD not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(url, serviceKey);
    const { data: pod, error: podErr } = await admin
      .from('proof_of_delivery')
      .select('id, fiscal_document_id')
      .eq('id', pod_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (podErr || !pod) {
      return new Response(JSON.stringify({ error: 'POD not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: signed, error: signErr } = await admin.storage
      .from(metadata.storage_bucket || 'receipts')
      .createSignedUrl(metadata.storage_path, 300);
    if (signErr || !signed?.signedUrl) {
      await admin.rpc('log_pod_access_v2', {
        _tenant_id: tenant_id,
        _pod_id: pod.id,
        _fiscal_document_id: pod.fiscal_document_id,
        _actor_user_id: userId,
        _success: false,
      }).catch(() => undefined);
      return new Response(JSON.stringify({ error: 'Could not sign URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.rpc('log_pod_access_v2', {
      _tenant_id: tenant_id,
      _pod_id: pod.id,
      _fiscal_document_id: pod.fiscal_document_id,
      _actor_user_id: userId,
      _success: true,
    }).catch(() => undefined);

    return new Response(JSON.stringify({ signed_url: signed.signedUrl }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
