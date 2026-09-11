import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type PipelineMode = "poll" | "full";
type DispatchStatus = "success" | "partial" | "failed" | "attention_required";

interface DispatchTarget {
  workspace_id: string;
  integration_account_id: string;
  tenant_id: string;
  lease_token: string;
  pipeline_mode: PipelineMode;
}

interface PipelineResponse {
  success?: unknown;
  status?: unknown;
}

interface DispatchResult {
  status: DispatchStatus;
  success: boolean;
  errorCode: string | null;
  nextDelaySeconds: number | null;
}

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safePipelineStatus(value: unknown): DispatchStatus | null {
  return value === "success" || value === "partial" || value === "failed" ||
      value === "attention_required"
    ? value
    : null;
}

async function runPipeline(
  target: DispatchTarget,
  supabaseUrl: string,
  anonKey: string,
  cronSecret: string,
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110_000);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/agvlog-pipeline-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "x-agvlog-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        tenant_id: target.tenant_id,
        integration_account_id: target.integration_account_id,
        pipeline_mode: target.pipeline_mode,
      }),
      signal: controller.signal,
    });

    let payload: PipelineResponse = {};
    try {
      payload = await response.json() as PipelineResponse;
    } catch {
      // A non-JSON response is deliberately reduced to a bounded code below.
    }

    const reportedStatus = safePipelineStatus(payload.status);
    if (response.ok && payload.success === true && reportedStatus === "success") {
      return { status: "success", success: true, errorCode: null, nextDelaySeconds: null };
    }

    if (reportedStatus === "attention_required") {
      return {
        status: "attention_required",
        success: false,
        errorCode: "PIPELINE_ATTENTION_REQUIRED",
        nextDelaySeconds: 900,
      };
    }

    const status = reportedStatus === "partial" ? "partial" : "failed";
    return {
      status,
      success: false,
      errorCode: response.ok
        ? "PIPELINE_UNCONFIRMED"
        : `PIPELINE_HTTP_${response.status}`,
      nextDelaySeconds: status === "partial" ? 300 : 600,
    };
  } catch (error: unknown) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      status: "failed",
      success: false,
      errorCode: timedOut ? "PIPELINE_TIMEOUT" : "PIPELINE_NETWORK_ERROR",
      nextDelaySeconds: 600,
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const cronSecret = req.headers.get("x-agvlog-cron-secret");

    if (!supabaseUrl || !serviceKey || !anonKey || !cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (!await isCronRequest(req, supabaseUrl, serviceKey)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("claim_workspace_ssx_dispatch_v1", {
      _limit: 8,
      _lease_seconds: 300,
    });
    if (error) {
      console.error("[agvlog-ssx-dispatcher] claim failed", { code: error.code });
      return jsonResponse({ success: false, error: "Dispatch claim failed" }, 500);
    }

    const targets = Array.isArray(data) ? data as DispatchTarget[] : [];
    if (targets.length === 0) {
      return jsonResponse({ success: true, claimed: 0, completed: 0, failed: 0 }, 200);
    }

    const outcomes = await Promise.all(targets.map(async (target) => {
      const result = await runPipeline(target, supabaseUrl, anonKey, cronSecret);
      const { data: acknowledged, error: ackError } = await admin.rpc(
        "ack_workspace_ssx_dispatch_v1",
        {
          _workspace_id: target.workspace_id,
          _lease_token: target.lease_token,
          _success: result.success,
          _status: result.status,
          _error_code: result.errorCode,
          _next_delay_seconds: result.nextDelaySeconds,
        },
      );
      if (ackError) {
        console.error("[agvlog-ssx-dispatcher] acknowledgement failed", {
          code: ackError.code,
        });
      }
      return {
        successful: result.success && acknowledged === true && !ackError,
        attentionRequired: result.status === "attention_required" && acknowledged === true,
        leaseLost: acknowledged !== true || Boolean(ackError),
      };
    }));

    const completed = outcomes.filter((outcome) => outcome.successful).length;
    const attentionRequired = outcomes.filter((outcome) => outcome.attentionRequired).length;
    const leaseLost = outcomes.filter((outcome) => outcome.leaseLost).length;
    const failed = targets.length - completed;
    return jsonResponse({
      success: failed === 0,
      claimed: targets.length,
      completed,
      failed,
      attention_required: attentionRequired,
      lease_lost: leaseLost,
    }, failed === 0 ? 200 : 207);
  } catch (error: unknown) {
    console.error("[agvlog-ssx-dispatcher] internal failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
