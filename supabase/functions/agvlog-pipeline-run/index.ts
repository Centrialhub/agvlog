import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;
    let authHeader = req.headers.get("Authorization") || "";

    // Auth: JWT or cron secret
    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret;

    if (!isCron) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
        authHeader.replace("Bearer ", "")
      );
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = claimsData.claims.sub as string;
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { tenant_id, integration_account_id } = body;

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin (skip for cron)
    if (!isCron && callerId) {
      const { data: membership } = await supabase
        .from("tenant_memberships").select("role")
        .eq("tenant_id", tenant_id).eq("user_id", callerId).eq("active", true)
        .limit(1).single();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const stats = {
      login: null as any,
      synced_units: 0,
      polled_units: 0,
      total_inserted: 0,
      processed_vehicles: 0,
      aggregated: 0,
      errors: [] as string[],
    };

    // Step 1: Get accounts to process
    let accountsQuery = supabase
      .from("integration_accounts")
      .select("id, status, token_expires_at")
      .eq("tenant_id", tenant_id);

    if (integration_account_id) {
      accountsQuery = accountsQuery.eq("id", integration_account_id);
    }

    const { data: accounts } = await accountsQuery;
    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No integration accounts", stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For each account: login if needed, then poll
    for (const account of accounts) {
      try {
        // Step A: Login if token < 60min
        const minutesLeft = account.token_expires_at
          ? (new Date(account.token_expires_at).getTime() - Date.now()) / 60000
          : -1;

        if (minutesLeft < 60) {
          const loginResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-login", {
            integration_account_id: account.id,
          });
          stats.login = loginResp;
        }

        // Step B: Poll positions
        const pollResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-poll-positions", {
          integration_account_id: account.id,
        });

        stats.polled_units += pollResp?.total_units || 0;
        stats.total_inserted += pollResp?.total_inserted || 0;
      } catch (e: any) {
        stats.errors.push(`Account ${account.id}: ${e.message}`);
      }
    }

    // Step C: Run processing queue
    try {
      const queueResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-run-queue", {
        tenant_id, limit: 50,
      });
      stats.processed_vehicles = queueResp?.processed || 0;
    } catch (e: any) {
      stats.errors.push(`Queue: ${e.message}`);
    }

    // Step D: Aggregate daily
    try {
      const aggResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-aggregate-daily", {
        tenant_id,
      });
      stats.aggregated = aggResp?.aggregated || 0;
    } catch (e: any) {
      stats.errors.push(`Aggregate: ${e.message}`);
    }

    return new Response(
      JSON.stringify({ success: true, ...stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("agvlog-pipeline-run error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function callEdgeFunction(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  isCron: boolean,
  cronSecret: string | null,
  functionName: string,
  body: any
): Promise<any> {
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": anonKey,
  };

  if (isCron && cronSecret) {
    headers["x-agvlog-cron-secret"] = cronSecret;
    // Also need auth header for functions that validate JWT
    headers["Authorization"] = `Bearer ${anonKey}`;
  } else {
    headers["Authorization"] = authHeader;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok && data?.error) {
    throw new Error(data.error);
  }

  return data;
}
