import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    const admin = createClient(url, serviceKey);

    // 1) fetch POD + fiscal doc
    const { data: pod, error: podErr } = await admin
      .from('proof_of_delivery')
      .select('id, tenant_id, fiscal_document_id, storage_bucket, storage_path')
      .eq('id', pod_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (podErr || !pod || !pod.storage_path) {
      return new Response(JSON.stringify({ error: 'POD not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2) Single check: same client_portal_access row that grants document access must also have can_download_documents=true
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: canDownload, error: accessErr } = await userClient.rpc('portal_user_can_download_fiscal_document', {
      _tenant_id: tenant_id,
      _fiscal_document_id: pod.fiscal_document_id,
    });
    if (accessErr || !canDownload) {
      return new Response(JSON.stringify({ error: 'Download not allowed' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // userId reserved for audit logging
    void userId;

    // 4) sign URL
    const { data: signed, error: signErr } = await admin.storage
      .from(pod.storage_bucket || 'receipts')
      .createSignedUrl(pod.storage_path, 300);
    if (signErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: 'Could not sign URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ signed_url: signed.signedUrl }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});