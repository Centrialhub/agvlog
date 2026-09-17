import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveTenant } from '../_shared/active-tenant.ts';

type JsonObject = Record<string, unknown>;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const json = (status: number, body: JsonObject) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const cleanFilename = (value: unknown) => String(value || 'arquivo')
  .replace(/[^A-Za-z0-9._-]/g, '-')
  .slice(0, 180) || 'arquivo';

function allowedSourceUrl(raw: string): URL {
  const url = new URL(raw);
  const configured = (Deno.env.get('PORTAL_DOWNLOAD_ALLOWED_HOSTS') || '')
    .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (!host.endsWith('.supabase.co') && !configured.includes(host))) {
    throw new Error('download_source_not_allowed');
  }
  return url;
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_FILE_BYTES) throw new Error('file_too_large');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error('file_too_large');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });

  let body: JsonObject;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_request' }); }
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : '';
  const tenantError = requireActiveTenant(req, tenantId);
  if (tenantError) return tenantError;

  const resourceType = typeof body.resource_type === 'string' ? body.resource_type : '';
  const resourceId = typeof body.resource_id === 'string' ? body.resource_id : '';
  const parentId = typeof body.parent_id === 'string' ? body.parent_id : null;
  const format = typeof body.format === 'string' ? body.format : 'pdf';

  const { data: authorizationData, error: authorizationError } = await userClient.rpc(
    'portal_authorize_download_v1',
    {
      _tenant_id: tenantId,
      _resource_type: resourceType,
      _resource_id: resourceId,
      _parent_id: parentId,
      _format: format,
    },
  );
  if (authorizationError || !authorizationData) return json(403, { error: 'download_not_allowed' });

  const authorized = authorizationData as JsonObject;
  if (authorized.actor_id !== userData.user.id || authorized.tenant_id !== tenantId) {
    return json(403, { error: 'download_not_allowed' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auditId = crypto.randomUUID();
  const auditInsert = await admin.from('portal_download_audit').insert({
    id: auditId,
    tenant_id: tenantId,
    actor_id: userData.user.id,
    resource_type: resourceType,
    resource_id: resourceId,
    parent_id: parentId,
    file_format: format,
    outcome: 'authorized',
    user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
  });
  if (auditInsert.error) return json(503, { error: 'download_audit_unavailable' });

  try {
    let rawUrl: string | null = null;
    let inlineContent: string | null = null;

    if (resourceType === 'cte') {
      const { data, error } = await admin.from('cte_documents')
        .select('pdf_url,xml_url,xml_content').eq('tenant_id', tenantId).eq('id', resourceId).single();
      if (error || !data) throw new Error('file_not_available');
      rawUrl = format === 'pdf' ? data.pdf_url : data.xml_url;
      inlineContent = format === 'xml' && !rawUrl ? data.xml_content : null;
    } else if (resourceType === 'nfse') {
      const { data, error } = await admin.from('nfse_documents')
        .select('pdf_url,xml_url').eq('tenant_id', tenantId).eq('id', resourceId).single();
      if (error || !data) throw new Error('file_not_available');
      rawUrl = format === 'pdf' ? data.pdf_url : data.xml_url;
    } else if (resourceType === 'financial_title') {
      const { data: receivable, error } = await admin.from('receivables')
        .select('client_invoice_id').eq('tenant_id', tenantId).eq('id', resourceId).single();
      if (error || !receivable) throw new Error('file_not_available');
      let invoice: { pdf_url: string | null } | null = null;
      if (receivable.client_invoice_id) {
        const direct = await admin.from('client_invoices').select('pdf_url')
          .eq('tenant_id', tenantId).eq('id', receivable.client_invoice_id).maybeSingle();
        invoice = direct.data;
      }
      if (!invoice?.pdf_url) {
        const linked = await admin.from('client_invoices').select('pdf_url')
          .eq('tenant_id', tenantId).eq('receivable_id', resourceId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        invoice = linked.data;
      }
      rawUrl = invoice?.pdf_url || null;
    }

    let bytes: Uint8Array;
    let sourceHost: string | null = null;
    if (rawUrl) {
      const source = allowedSourceUrl(rawUrl);
      sourceHost = source.hostname;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const upstream = await fetch(source, { signal: controller.signal, redirect: 'error' });
        if (!upstream.ok) throw new Error(`upstream_${upstream.status}`);
        bytes = await boundedBody(upstream);
      } finally { clearTimeout(timeout); }
    } else if (inlineContent) {
      bytes = new TextEncoder().encode(inlineContent);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('file_too_large');
    } else {
      throw new Error('file_not_available');
    }

    const served = await admin.from('portal_download_audit').update({
      outcome: 'served', response_status: 200, source_host: sourceHost, completed_at: new Date().toISOString(),
    }).eq('id', auditId);
    if (served.error) throw new Error('download_audit_unavailable');

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': String(authorized.content_type || 'application/octet-stream'),
        'Content-Disposition': `attachment; filename="${cleanFilename(authorized.filename)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    await admin.from('portal_download_audit').update({
      outcome: 'failed', response_status: 502, completed_at: new Date().toISOString(),
    }).eq('id', auditId);
    console.error('[portal-download-file]', error instanceof Error ? error.message : String(error));
    return json(502, { error: 'file_not_available' });
  }
});
