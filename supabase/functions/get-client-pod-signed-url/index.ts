import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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

    // 2) check access via helper (auth context: pretend user)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: hasAccess, error: accessErr } = await userClient.rpc('portal_user_can_access_fiscal_document', {
      _tenant_id: tenant_id,
      _fiscal_document_id: pod.fiscal_document_id,
    });
    if (accessErr || !hasAccess) {
      return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3) require can_download_documents
    const { data: perm } = await admin
      .from('client_portal_access')
      .select('can_download_documents')
      .eq('tenant_id', tenant_id)
      .eq('user_id', userId)
      .eq('active', true)
      .eq('can_download_documents', true)
      .limit(1);
    if (!perm || perm.length === 0) {
      return new Response(JSON.stringify({ error: 'Download not allowed' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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