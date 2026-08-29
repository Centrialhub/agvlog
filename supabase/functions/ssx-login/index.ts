/**
 * ssx-login — Authenticates with SSX and caches the JWT token.
 * 
 * Login uses query string params (per SSX Swagger spec).
 * The /Login endpoint does NOT use api_version prefix.
 * Token TTL handles seconds, .NET ticks, and milliseconds.
 * On success, clears skip_admin_until so sync can retry Administration immediately.
 */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders,
  logIntegration,
  getTenantRole,
} from "../_shared/ssx-utils.ts";

type JsonObject = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeUpstreamFailure(status: number, responseText: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === 'object'
      ? parsed.error as Record<string, unknown>
      : {};
    const candidate = error.message ?? error.code ?? parsed.message ?? parsed.Message;
    if (typeof candidate === 'string' || typeof candidate === 'number') detail = String(candidate);
  } catch {
    // Non-JSON upstream bodies are intentionally not persisted or returned.
  }
  const sanitized = detail
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(password|senha|token|secret|cookie)\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]')
    .slice(0, 200);
  return `HTTP ${status}${sanitized ? `: ${sanitized}` : ''}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;

    const isCron = await isCronRequest(req, supabaseUrl, supabaseServiceKey);

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
    const { integration_account_id, force = false } = await req.json();
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

    const capabilityResponse = await requireIntegrationCapability(supabase, account.tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const settings = (account.settings || {}) as JsonObject;
    if (!force && settings.credential_reentry_required === true) {
      return jsonResp({
        error: "A senha SSX precisa ser informada novamente pelo administrador",
        code: "SSX_CREDENTIAL_REENTRY_REQUIRED",
      }, 409);
    }
    const backoffUntil = settings.ssx_login_backoff_until
      ? new Date(settings.ssx_login_backoff_until).getTime()
      : 0;
    if (!force && backoffUntil > Date.now()) {
      return jsonResp({
        error: 'SSX login temporarily paused after repeated failures',
        code: 'SSX_LOGIN_BACKOFF',
        retry_at: settings.ssx_login_backoff_until,
      }, 429);
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

    let password = account.password_encrypted || '';
    try {
      if (!password) throw new Error('SSX password is missing');
      if (password.startsWith("enc:v1:")) {
        const encryptionKey = Deno.env.get("AGVLOG_ENCRYPTION_KEY");
        if (!encryptionKey) throw new Error('AGVLOG_ENCRYPTION_KEY is missing');
        password = await decryptAesGcm(password, encryptionKey);
      }
    } catch (decryptError: unknown) {
      const failure = nextLoginBackoff(settings);
      const message = 'A senha SSX precisa ser informada novamente pelo administrador';
      await supabase.from('integration_accounts').update({
        status: 'invalid_credentials',
        last_error: `${message}: ${errorMessage(decryptError)}`,
        settings: { ...failure.settings, credential_reentry_required: true },
        updated_at: new Date().toISOString(),
      }).eq('id', integration_account_id);
      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: 'ssx_login',
        success: false,
        error_message: message,
        metadata: { retry_at: failure.retryAt, credential_reentry_required: true },
      });
      return jsonResp({
        error: message,
        code: 'SSX_CREDENTIAL_REENTRY_REQUIRED',
        retry_at: failure.retryAt,
      }, 409);
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
    } catch (fetchErr: unknown) {
      const failure = nextLoginBackoff(settings);
      await supabase.from("integration_accounts").update({
        status: "degraded",
        last_error: `SSX unreachable: ${errorMessage(fetchErr)}`,
        settings: failure.settings,
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_login", endpoint: loginUrl,
        success: false, error_message: `SSX unreachable: ${errorMessage(fetchErr)}`,
        duration_ms: Date.now() - startTime,
      });
      return jsonResp({ error: "SSX unreachable", details: errorMessage(fetchErr), retry_at: failure.retryAt }, 502);
    }

    const duration = Date.now() - startTime;
    console.log(`[SSX:login] POST ${loginUrl} | status=${ssxResponse.status} | ${duration}ms`);

    if (!ssxResponse.ok) {
      const failureSummary = safeUpstreamFailure(ssxResponse.status, responseText);
      const failure = nextLoginBackoff(settings);
      const newStatus = ssxResponse.status === 401 ? "invalid_credentials" : "degraded";
      await supabase.from("integration_accounts").update({
        status: newStatus,
        last_error: failureSummary,
        settings: failure.settings,
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_login", endpoint: loginUrl,
        status_code: ssxResponse.status, success: false,
        error_message: failureSummary,
        duration_ms: duration,
      });
      return jsonResp({
        error: "SSX login failed", status_code: ssxResponse.status,
        details: failureSummary, retry_at: failure.retryAt,
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
      const failure = nextLoginBackoff(settings);
      await supabase.from("integration_accounts").update({
        status: "degraded",
        last_error: "Login succeeded but no valid token in response",
        settings: failure.settings,
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);
      return jsonResp({ error: "No valid token in SSX response", retry_at: failure.retryAt }, 502);
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

    // On login success: clear admin skip, backoff, and admin token cache
    // so sync retries immediately with fresh tokens
    const updatedSettings = { ...settings };
    delete updatedSettings.skip_admin_until;
    delete updatedSettings.last_admin_error;
    delete updatedSettings.sync_units_backoff_until;
    delete updatedSettings.admin_token_cache;
    delete updatedSettings.admin_token_expires_at;
    updatedSettings.sync_units_backoff_count = 0;
    delete updatedSettings.ssx_login_backoff_count;
    delete updatedSettings.ssx_login_backoff_until;
    delete updatedSettings.credential_reentry_required;

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
  } catch (err: unknown) {
    console.error("[SSX:login] error:", err);
    return jsonResp({ error: "Internal error", details: errorMessage(err) }, 500);
  }
});

// ==================== Helpers ====================

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nextLoginBackoff(settings: JsonObject): {
  settings: JsonObject;
  retryAt: string;
} {
  const count = Math.min(Number(settings.ssx_login_backoff_count || 0) + 1, 6);
  const delayMinutes = Math.min(3 * (2 ** (count - 1)), 60);
  const retryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  return {
    settings: {
      ...settings,
      ssx_login_backoff_count: count,
      ssx_login_backoff_until: retryAt,
    },
    retryAt,
  };
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
