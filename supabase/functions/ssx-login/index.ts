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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;

    // Auth: JWT or cron secret
    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { integration_account_id } = await req.json();
    if (!integration_account_id) {
      return new Response(
        JSON.stringify({ error: "integration_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration account
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("id", integration_account_id)
      .single();

    if (accErr || !account) {
      return new Response(
        JSON.stringify({ error: "Integration account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is admin/owner of this tenant (skip for cron)
    if (!isCron && callerId) {
      const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check if token is still valid (>60min remaining)
    if (account.token_cache && account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at);
      const minutesLeft = (expiresAt.getTime() - Date.now()) / 60000;
      if (minutesLeft > 60) {
        return new Response(
          JSON.stringify({
            success: true,
            cached: true,
            expires_at: account.token_expires_at,
            status: account.status,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build SSX login request
    const baseUrl = account.base_url.replace(/\/$/, "");
    const loginUrl = `${baseUrl}/Login`;

    // Decrypt password if encrypted
    let password = account.password_encrypted;
    if (password.startsWith("enc:v1:")) {
      const encryptionKey = Deno.env.get("AGVLOG_ENCRYPTION_KEY");
      if (encryptionKey) {
        password = await decryptAesGcm(password, encryptionKey);
      }
    }

    // Build query string params per SSX Swagger spec
    const params = new URLSearchParams();
    params.append("Username", account.username);
    params.append("Password", password);
    if (account.hashauth) params.append("HashAuth", account.hashauth);
    if (account.hashcode) params.append("Hashcentral", account.hashcode);

    const loginUrlWithParams = `${loginUrl}?${params.toString()}`;

    const startTime = Date.now();
    let ssxResponse: Response;
    let responseText = "";

    try {
      ssxResponse = await fetch(loginUrlWithParams, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      responseText = await ssxResponse.text();
    } catch (fetchErr: any) {
      await supabase
        .from("integration_accounts")
        .update({
          status: "degraded",
          last_error: `SSX unreachable: ${fetchErr.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_login",
        endpoint: loginUrl,
        success: false,
        error_message: `SSX unreachable: ${fetchErr.message}`,
        duration_ms: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({ error: "SSX unreachable", details: fetchErr.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const duration = Date.now() - startTime;

    if (!ssxResponse.ok) {
      const newStatus = ssxResponse.status === 401 ? "invalid_credentials" : "degraded";

      await supabase
        .from("integration_accounts")
        .update({
          status: newStatus,
          last_error: `HTTP ${ssxResponse.status}: ${responseText.substring(0, 500)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_login",
        endpoint: loginUrl,
        status_code: ssxResponse.status,
        success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({
          error: "SSX login failed",
          status_code: ssxResponse.status,
          details: responseText.substring(0, 200),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse token from response
    let token: string;
    let expiresInSeconds: number | null = null;
    console.log("SSX login response (first 200 chars):", responseText.substring(0, 200));
    try {
      const parsed = JSON.parse(responseText);
      token = parsed.AccessToken || parsed.access_token || parsed.Token || parsed.token || responseText;
      expiresInSeconds = parsed.ExpiresIn || parsed.expires_in || null;
      if (typeof token === "object") {
        token = JSON.stringify(token);
      }
    } catch {
      token = responseText.trim().replace(/^"/, "").replace(/"$/, "");
    }

    if (!token || token.length < 10) {
      await supabase
        .from("integration_accounts")
        .update({
          status: "degraded",
          last_error: "Login succeeded but no valid token in response",
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      return new Response(
        JSON.stringify({ error: "No valid token in SSX response" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cache token using ExpiresIn from SSX or default 24h
    const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
    const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days max
    const MIN_TTL_MS = 5 * 60 * 1000; // 5 min minimum
    let ttlMs = DEFAULT_TTL_MS;
    try {
      let parsedExpires = Number(expiresInSeconds);
      if (Number.isFinite(parsedExpires) && parsedExpires > 0) {
        // Detect .NET ticks (values > 1e12 are likely ticks or milliseconds, not seconds)
        if (parsedExpires > 1e12) {
          console.warn(`ExpiresIn looks like ticks/ms (${parsedExpires}), converting to seconds`);
          // If > 1e15, it's likely .NET ticks (100ns units since epoch)
          if (parsedExpires > 1e15) {
            const ticksEpoch = 621355968000000000; // .NET epoch offset
            const expiresDateMs = (parsedExpires - ticksEpoch) / 10000;
            parsedExpires = Math.max(0, (expiresDateMs - Date.now()) / 1000);
          } else {
            // Likely milliseconds
            parsedExpires = parsedExpires / 1000;
          }
        }
        ttlMs = parsedExpires * 1000;
        // Clamp to safe range
        if (ttlMs > MAX_TTL_MS) {
          console.warn(`TTL ${ttlMs}ms exceeds max, clamping to ${MAX_TTL_MS}ms (7d)`);
          ttlMs = MAX_TTL_MS;
        }
        if (ttlMs < MIN_TTL_MS) {
          console.warn(`TTL ${ttlMs}ms below min, using default ${DEFAULT_TTL_MS}ms`);
          ttlMs = DEFAULT_TTL_MS;
        }
      }
    } catch {
      // keep default
    }

    const nowMs = Date.now();
    let expiresAt: string;
    let nowIso: string;
    try {
      expiresAt = new Date(nowMs + ttlMs).toISOString();
      nowIso = new Date(nowMs).toISOString();
    } catch {
      // Ultimate fallback — should never happen but prevents 500
      expiresAt = new Date(nowMs + DEFAULT_TTL_MS).toISOString();
      nowIso = new Date(nowMs).toISOString();
    }
    console.log("Token TTL calc:", { expiresInSeconds, ttlMs, expiresAt });

    await supabase
      .from("integration_accounts")
      .update({
        token_cache: token,
        token_expires_at: expiresAt,
        status: "ok",
        last_login_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id,
      integration_account_id,
      action: "ssx_login",
      endpoint: loginUrl,
      status_code: ssxResponse.status,
      success: true,
      duration_ms: duration,
      metadata: { token_expires_at: expiresAt },
    });

    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        expires_at: expiresAt,
        status: "ok",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-login error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getTenantRole(
  supabase: any,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.role;
}

async function logIntegration(
  supabase: any,
  log: {
    tenant_id: string;
    integration_account_id: string;
    action: string;
    endpoint?: string;
    status_code?: number;
    success: boolean;
    error_message?: string;
    duration_ms?: number;
    metadata?: Record<string, any>;
  }
) {
  try {
    await supabase.from("integration_logs").insert(log);
  } catch (e) {
    console.error("Failed to log integration event:", e);
  }
}

async function decryptAesGcm(encrypted: string, keyHex: string): Promise<string> {
  const parts = encrypted.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted format");
  const ivHex = parts[2];
  const ctHex = parts[3];

  const keyBytes = hexToBytes(keyHex.padEnd(64, "0").slice(0, 64));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(ctHex);

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
