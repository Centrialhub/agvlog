/**
 * ssx-login — Authenticates with SSX and caches the JWT token.
 * 
 * Login uses query string params (per SSX Swagger spec).
 * The /Login endpoint does NOT use api_version prefix.
 * Token TTL handles seconds, .NET ticks, and milliseconds.
 * On success, clears skip_admin_until so sync can retry Administration immediately.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  logIntegration,
  getTenantRole,
} from "../_shared/ssx-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;

    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { integration_account_id } = await req.json();
    if (!integration_account_id) {
      return jsonResp({ error: "integration_account_id required" }, 400);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    if (!isCron && callerId) {
      const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return jsonResp({ error: "Forbidden: admin role required" }, 403);
      }
    }

    // Check if token is still valid (>60min remaining)
    if (account.token_cache && account.token_expires_at) {
      const minutesLeft = (new Date(account.token_expires_at).getTime() - Date.now()) / 60000;
      if (minutesLeft > 60) {
        return jsonResp({
          success: true, cached: true,
          expires_at: account.token_expires_at, status: account.status,
        });
      }
    }

    // Login endpoint does NOT use api_version prefix
    const baseUrl = (account.base_url || "").replace(/\/$/, "");
    const loginUrl = `${baseUrl}/Login`;

    let password = account.password_encrypted;
    if (password.startsWith("enc:v1:")) {
      const encryptionKey = Deno.env.get("AGVLOG_ENCRYPTION_KEY");
      if (encryptionKey) {
        password = await decryptAesGcm(password, encryptionKey);
      }
    }

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
        method: "POST", headers: { Accept: "application/json" },
      });
      responseText = await ssxResponse.text();
    } catch (fetchErr: any) {
      await supabase.from("integration_accounts").update({
        status: "degraded",
        last_error: `SSX unreachable: ${fetchErr.message}`,
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_login", endpoint: loginUrl,
        success: false, error_message: `SSX unreachable: ${fetchErr.message}`,
        duration_ms: Date.now() - startTime,
      });
      return jsonResp({ error: "SSX unreachable", details: fetchErr.message }, 502);
    }

    const duration = Date.now() - startTime;
    console.log(`[SSX:login] POST ${loginUrl} | status=${ssxResponse.status} | ${duration}ms | response=${responseText.substring(0, 200)}`);

    if (!ssxResponse.ok) {
      const newStatus = ssxResponse.status === 401 ? "invalid_credentials" : "degraded";
      await supabase.from("integration_accounts").update({
        status: newStatus,
        last_error: `HTTP ${ssxResponse.status}: ${responseText.substring(0, 500)}`,
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_login", endpoint: loginUrl,
        status_code: ssxResponse.status, success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });
      return jsonResp({
        error: "SSX login failed", status_code: ssxResponse.status,
        details: responseText.substring(0, 200),
      }, 502);
    }

    // Parse token
    let token: string;
    let expiresInSeconds: number | null = null;
    try {
      const parsed = JSON.parse(responseText);
      token = parsed.AccessToken || parsed.access_token || parsed.Token || parsed.token || responseText;
      expiresInSeconds = parsed.ExpiresIn || parsed.expires_in || null;
      if (typeof token === "object") token = JSON.stringify(token);
    } catch {
      token = responseText.trim().replace(/^"/, "").replace(/"$/, "");
    }

    if (!token || token.length < 10) {
      await supabase.from("integration_accounts").update({
        status: "degraded",
        last_error: "Login succeeded but no valid token in response",
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);
      return jsonResp({ error: "No valid token in SSX response" }, 502);
    }

    // Calculate token TTL
    const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const MIN_TTL_MS = 5 * 60 * 1000;
    let ttlMs = DEFAULT_TTL_MS;
    try {
      let parsedExpires = Number(expiresInSeconds);
      if (Number.isFinite(parsedExpires) && parsedExpires > 0) {
        if (parsedExpires > 1e12) {
          console.warn(`[SSX:login] ExpiresIn looks like ticks/ms (${parsedExpires}), converting`);
          if (parsedExpires > 1e15) {
            const ticksEpoch = 621355968000000000;
            const expiresDateMs = (parsedExpires - ticksEpoch) / 10000;
            parsedExpires = Math.max(0, (expiresDateMs - Date.now()) / 1000);
          } else {
            parsedExpires = parsedExpires / 1000;
          }
        }
        ttlMs = parsedExpires * 1000;
        if (ttlMs > MAX_TTL_MS) ttlMs = MAX_TTL_MS;
        if (ttlMs < MIN_TTL_MS) ttlMs = DEFAULT_TTL_MS;
      }
    } catch { /* keep default */ }

    const nowMs = Date.now();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    // On login success: clear admin skip and backoff so sync retries immediately
    const settings = (account.settings || {}) as Record<string, any>;
    const updatedSettings = { ...settings };
    delete updatedSettings.skip_admin_until;
    delete updatedSettings.last_admin_error;
    delete updatedSettings.sync_units_backoff_until;
    updatedSettings.sync_units_backoff_count = 0;

    // Ensure api_version is set (backfill for old accounts)
    if (!updatedSettings.api_version) {
      updatedSettings.api_version = "v3";
    }

    await supabase.from("integration_accounts").update({
      token_cache: token,
      token_expires_at: expiresAt,
      status: "ok",
      last_login_at: nowIso,
      last_error: null,
      updated_at: nowIso,
      settings: updatedSettings,
    }).eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id, integration_account_id,
      action: "ssx_login", endpoint: loginUrl,
      status_code: ssxResponse.status, success: true,
      duration_ms: duration,
      metadata: { token_expires_at: expiresAt, ttl_ms: ttlMs },
    });

    return jsonResp({ success: true, cached: false, expires_at: expiresAt, status: "ok" });
  } catch (err: any) {
    console.error("[SSX:login] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== Helpers ====================

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
