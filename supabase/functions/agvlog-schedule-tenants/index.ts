import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { isCronRequest } from '../_shared/cron-auth.ts';

type DueSchedule = { tenant_id: string; pipeline_mode: 'poll' | 'full' };

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return response({ error: 'server_not_configured' }, 503);
  if (!await isCronRequest(req, url, serviceKey)) return response({ error: 'unauthorized' }, 401);

  const cronSecret = req.headers.get('x-agvlog-cron-secret');
  if (!cronSecret) return response({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({})) as { limit?: unknown };
  const limit = Math.max(1, Math.min(8, Number(body.limit) || 8));
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const geocodingRun = invokeAddressResolutionWorker(url, anonKey, cronSecret);
  const { data, error } = await admin.rpc('claim_due_tracking_schedules_v1', { _limit: limit });
  if (error) return response({ error: 'schedule_claim_failed' }, 503);
  const due = Array.isArray(data) ? data as DueSchedule[] : [];

  const results = await Promise.all(due.map(async (schedule) => {
    let status: 'success' | 'partial' | 'failed' | 'attention_required' = 'failed';
    let detail: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 150_000);
      let pipelineResponse: Response;
      try {
        pipelineResponse = await fetch(`${url}/functions/v1/agvlog-pipeline-run`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${anonKey}`,
            'x-agvlog-cron-secret': cronSecret,
          },
          body: JSON.stringify({ tenant_id: schedule.tenant_id, pipeline_mode: schedule.pipeline_mode }),
        });
      } finally {
        clearTimeout(timer);
      }
      const payload = await pipelineResponse.json().catch(() => ({})) as { status?: unknown; error?: unknown; details?: unknown };
      status = ['success', 'partial', 'failed', 'attention_required'].includes(String(payload.status))
        ? String(payload.status) as typeof status
        : pipelineResponse.ok ? 'success' : 'failed';
      detail = pipelineResponse.ok ? null : String(payload.error || payload.details || `HTTP ${pipelineResponse.status}`);
    } catch (failure) {
      detail = failure instanceof Error ? failure.message : 'pipeline_invocation_failed';
    }
    await admin.rpc('record_tracking_schedule_result_v1', {
      _tenant_id: schedule.tenant_id,
      _status: status,
      _error: detail,
    });
    return { tenant_id: schedule.tenant_id, pipeline_mode: schedule.pipeline_mode, status, error: detail };
  }));
  const geocoding = await geocodingRun;

  return response({
    success: results.every((item) => item.status === 'success') && geocoding.success,
    claimed: due.length,
    results,
    address_resolution: geocoding,
  });
});

async function invokeAddressResolutionWorker(url: string, anonKey: string, cronSecret: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const workerResponse = await fetch(`${url}/functions/v1/process-address-resolution-queue`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        'x-agvlog-cron-secret': cronSecret,
      },
      body: JSON.stringify({ limit: 5 }),
    });
    const payload = await workerResponse.json().catch(() => ({})) as Record<string, unknown>;
    return {
      success: workerResponse.ok && payload.success !== false,
      status: workerResponse.status,
      claimed: Number(payload.claimed) || 0,
      error: workerResponse.ok ? null : String(payload.error || `HTTP ${workerResponse.status}`).slice(0, 300),
    };
  } catch (failure) {
    return {
      success: false,
      status: 503,
      claimed: 0,
      error: failure instanceof Error ? failure.message.slice(0, 300) : 'address_worker_unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}
