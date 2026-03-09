/**
 * SSX Integration Shared Utilities
 * 
 * Centralizes URL building, response normalization, error classification,
 * HTTP helpers, and logging for all SSX edge functions.
 * 
 * DESIGN DECISIONS:
 * - Administration API is the PRIMARY source for tracker/vehicle catalogs.
 * - PositionHistory is a FALLBACK only, never the authoritative source.
 * - Administration API does NOT use version prefix (endpoints are /Administration/...).
 * - Tracking API uses version prefix (e.g., /v3/Tracking/...).
 * - HashAuth in Login scopes the token to Tracking integration only.
 *   Administration endpoints require a token obtained WITHOUT HashAuth.
 * - Secrets (token, password, hash) are NEVER logged in plaintext.
 */

// ======================== CORS ========================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

// ======================== URL Builder ========================

/**
 * Builds a versioned SSX endpoint URL (for Tracking endpoints).
 * Example: buildSsxUrl("https://integration.systemsatx.com.br", "v3", "/Tracking/PositionHistory/List")
 *   => "https://integration.systemsatx.com.br/v3/Tracking/PositionHistory/List"
 */
export function buildSsxUrl(baseUrl: string, apiVersion: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const ver = (apiVersion || "v3").replace(/^\//, "").replace(/\/$/, "");
  return `${base}/${ver}${cleanPath}`;
}

/**
 * Returns ordered endpoint candidates for Tracking: versioned first, then unversioned.
 * Used for fallback on 404.
 */
export function buildSsxUrlCandidates(baseUrl: string, apiVersion: string, path: string): string[] {
  const base = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const ver = (apiVersion || "v3").replace(/^\//, "").replace(/\/$/, "");
  const urls: string[] = [`${base}/${ver}${cleanPath}`];
  // Add unversioned only if different
  const unversioned = `${base}${cleanPath}`;
  if (!urls.includes(unversioned)) urls.push(unversioned);
  return urls;
}

/**
 * Builds Administration API URL — NO version prefix.
 * Per SSX swagger, Administration endpoints are at /Administration/... directly.
 * Example: buildAdminUrl("https://integration.systemsatx.com.br", "/Administration/Tracker/List")
 *   => "https://integration.systemsatx.com.br/Administration/Tracker/List"
 */
export function buildAdminUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

// ======================== Account Config Reader ========================

export interface SsxAccountConfig {
  baseUrl: string;
  apiVersion: string;
  token: string;
  adminToken: string | null; // Token without HashAuth for Administration
  pollWindowMinutes: number;
  requestTimeoutMs: number;
  settings: Record<string, any>;
  hashauth: string | null;
  hashcode: string | null;
  username: string;
  passwordEncrypted: string;
}

export function readAccountConfig(account: any): SsxAccountConfig {
  const settings = (account.settings || {}) as Record<string, any>;
  return {
    baseUrl: (account.base_url || "").replace(/\/$/, ""),
    apiVersion: settings.api_version || "v3",
    token: account.token_cache || "",
    adminToken: settings.admin_token_cache || null,
    pollWindowMinutes: settings.poll_window_minutes || 15,
    requestTimeoutMs: settings.request_timeout_ms || 30_000,
    settings,
    hashauth: account.hashauth || null,
    hashcode: account.hashcode || null,
    username: account.username || "",
    passwordEncrypted: account.password_encrypted || "",
  };
}

// ======================== Admin Token Login ========================

/**
 * Obtains a token WITHOUT HashAuth for Administration API access.
 * The SSX Login with HashAuth scopes the token to Tracking integration only.
 * Administration endpoints require a token without HashAuth.
 * 
 * If the account has no HashAuth, the regular token works for both.
 */
export async function getAdminToken(
  config: SsxAccountConfig,
  supabase: any,
  integrationAccountId: string,
): Promise<{ token: string | null; error: string | null }> {
  // If no HashAuth is configured, the regular token already has admin scope
  if (!config.hashauth) {
    console.log("[SSX:admin-token] No HashAuth configured, using regular token for admin");
    return { token: config.token, error: null };
  }

  // Check cached admin token
  if (config.adminToken && config.settings.admin_token_expires_at) {
    const expiresAt = new Date(config.settings.admin_token_expires_at).getTime();
    if (expiresAt - Date.now() > 60_000) {
      console.log("[SSX:admin-token] Using cached admin token");
      return { token: config.adminToken, error: null };
    }
  }

  // Do a fresh login WITHOUT HashAuth
  console.log("[SSX:admin-token] Logging in without HashAuth for Administration access...");
  const loginUrl = `${config.baseUrl}/Login`;

  let password = config.passwordEncrypted;
  if (password.startsWith("enc:v1:")) {
    const encryptionKey = Deno.env.get("AGVLOG_ENCRYPTION_KEY");
    if (encryptionKey) {
      try {
        password = await decryptAesGcm(password, encryptionKey);
      } catch (e: any) {
        console.error("[SSX:admin-token] Decryption failed:", e.message);
        return { token: null, error: `Decryption failed: ${e.message}` };
      }
    }
  }

  const params = new URLSearchParams();
  params.append("Username", config.username);
  params.append("Password", password);
  // Intentionally NOT including HashAuth — this gives admin scope
  if (config.hashcode) params.append("Hashcentral", config.hashcode);

  const loginUrlWithParams = `${loginUrl}?${params.toString()}`;
  const startTime = Date.now();

  try {
    const resp = await fetch(loginUrlWithParams, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const text = await resp.text();
    const duration = Date.now() - startTime;
    console.log(`[SSX:admin-token] POST ${loginUrl} (no HashAuth) | status=${resp.status} | ${duration}ms | response=${text.substring(0, 150)}`);

    if (!resp.ok) {
      return { token: null, error: `Login without HashAuth failed: HTTP ${resp.status}: ${text.substring(0, 200)}` };
    }

    let token: string;
    let expiresInSeconds: number | null = null;
    try {
      const parsed = JSON.parse(text);
      token = parsed.AccessToken || parsed.access_token || parsed.Token || parsed.token || text;
      expiresInSeconds = parsed.ExpiresIn || parsed.expires_in || null;
      if (typeof token === "object") token = JSON.stringify(token);
    } catch {
      token = text.trim().replace(/^"/, "").replace(/"$/, "");
    }

    if (!token || token.length < 10) {
      return { token: null, error: "Login succeeded but no valid admin token in response" };
    }

    // Calculate TTL
    const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const MIN_TTL_MS = 5 * 60 * 1000;
    let ttlMs = DEFAULT_TTL_MS;
    try {
      let parsedExpires = Number(expiresInSeconds);
      if (Number.isFinite(parsedExpires) && parsedExpires > 0) {
        if (parsedExpires > 1e12) {
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

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    // Cache admin token in settings
    const { data: currentAccount } = await supabase
      .from("integration_accounts").select("settings").eq("id", integrationAccountId).single();
    const currentSettings = currentAccount?.settings || {};
    await supabase.from("integration_accounts").update({
      settings: {
        ...currentSettings,
        admin_token_cache: token,
        admin_token_expires_at: expiresAt,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", integrationAccountId);

    console.log(`[SSX:admin-token] Admin token obtained, expires at ${expiresAt}`);
    return { token, error: null };
  } catch (e: any) {
    return { token: null, error: `Admin login failed: ${e.message}` };
  }
}

// ======================== Error Classification ========================

export type SsxErrorClass =
  | "auth_error"         // 401/403
  | "route_not_found"    // 404
  | "body_incompatible"  // 400/415
  | "rate_limited"       // 429
  | "empty_response"     // 200 but no items
  | "timeout"            // network timeout
  | "parse_error"        // JSON parse failure
  | "network_error"      // unreachable
  | "server_error"       // 5xx
  | "unknown";           // anything else

export function classifyError(statusCode: number, networkError?: string, parseError?: boolean): SsxErrorClass {
  if (networkError) {
    if (networkError.toLowerCase().includes("timeout") || networkError.toLowerCase().includes("timed out")) return "timeout";
    return "network_error";
  }
  if (parseError) return "parse_error";
  if (statusCode === 401 || statusCode === 403) return "auth_error";
  if (statusCode === 404) return "route_not_found";
  if (statusCode === 400 || statusCode === 415) return "body_incompatible";
  if (statusCode === 429) return "rate_limited";
  if (statusCode >= 500) return "server_error";
  return "unknown";
}

/** Returns true if this error class should trigger a retry */
export function isRetryable(errorClass: SsxErrorClass): boolean {
  return ["rate_limited", "timeout", "network_error", "server_error"].includes(errorClass);
}

/** Returns true if this error class means we should NOT retry with same credentials */
export function isAuthFailure(errorClass: SsxErrorClass): boolean {
  return errorClass === "auth_error";
}

// ======================== Response Normalizer ========================

/**
 * Extracts the array of items from any SSX API response format.
 * Handles: raw array, { Data: [] }, { Items: [] }, { Trackers: [] }, paginated wrappers, etc.
 */
export function extractResponseItems(parsed: any): any[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object") return [];

  // Direct array fields (most common SSX formats)
  const directKeys = [
    "Data", "data", "Items", "items", "Result", "result",
    "Results", "results", "Records", "records",
    "Trackers", "trackers", "Vehicles", "vehicles",
    "Units", "units", "Positions", "positions",
    "Content", "content", "List", "list",
    "TrackedUnits", "trackedUnits",
  ];
  for (const key of directKeys) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }

  // Nested: paginated wrappers like { Data: { Items: [] } }
  const outerKeys = ["Data", "data", "Result", "result", "Content", "content"];
  for (const outerKey of outerKeys) {
    const outer = parsed[outerKey];
    if (outer && typeof outer === "object" && !Array.isArray(outer)) {
      for (const innerKey of ["Items", "items", "Data", "data", "Records", "records", "List", "list"]) {
        if (Array.isArray(outer[innerKey])) return outer[innerKey];
      }
    }
  }

  return [];
}

// ======================== Tracker/Unit Normalizer ========================

export interface NormalizedUnit {
  external_id: string | null;
  external_code: string;
  tracker_id: string | null;
  vehicle_id_external: string | null;
  name: string | null;
  plate: string | null;
  imei: string | null;
  serial: string | null;
  status: string | null;
  last_position_at: string | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  ignition: boolean | null;
  source_endpoint: string;
  source_mode: "admin_catalog" | "tracking_fallback";
}

/**
 * Normalizes a raw SSX tracker/unit item into a standard internal structure.
 * Handles different field naming conventions from various SSX API versions.
 */
export function normalizeTrackerItem(raw: any, sourceEndpoint: string, sourceMode: "admin_catalog" | "tracking_fallback"): NormalizedUnit | null {
  const externalCode = pickFirst(raw, [
    "TrackedUnitIntegrationCode", "TrackerIntegrationCode",
    "IntegrationCode", "Code", "TrackedUnit",
    "TrackerCode", "SerialNumber", "IMEI", "Imei",
    "integrationCode", "code", "trackedUnit",
  ]);
  if (!externalCode) return null;

  return {
    external_id: pickFirst(raw, ["Id", "id", "TrackerId", "trackerId"]) || null,
    external_code: String(externalCode).trim(),
    tracker_id: pickFirst(raw, ["TrackerId", "trackerId", "TrackerUnitId"]) || null,
    vehicle_id_external: pickFirst(raw, ["VehicleId", "vehicleId"]) || null,
    name: pickFirst(raw, ["Description", "Name", "Model", "TrackerModel", "name", "description"]) || null,
    plate: pickFirst(raw, ["Plate", "plate", "LicensePlate", "licensePlate", "VehiclePlate", "vehiclePlate"]) || null,
    imei: pickFirst(raw, ["IMEI", "Imei", "imei"]) || null,
    serial: pickFirst(raw, ["SerialNumber", "serialNumber", "Serial", "serial"]) || null,
    status: pickFirst(raw, ["Status", "status", "State", "state"]) || null,
    last_position_at: pickFirst(raw, ["LastPositionDate", "lastPositionDate", "DateTimeGPS", "dateTimeGPS"]) || null,
    latitude: pickNumber(raw, ["Latitude", "latitude", "Lat", "lat", "Y", "y"]),
    longitude: pickNumber(raw, ["Longitude", "longitude", "Lng", "lng", "X", "x"]),
    speed: pickNumber(raw, ["Speed", "speed", "Velocidade"]),
    ignition: pickBoolean(raw, ["Ignition", "ignition", "IgnitionOn", "ignitionOn"]),
    source_endpoint: sourceEndpoint,
    source_mode: sourceMode,
  };
}

/** Picks tracker code from a vehicle record (for cross-referencing) */
export function pickTrackerCodeFromVehicle(item: any): string | null {
  const direct = pickFirst(item, [
    "TrackedUnitIntegrationCode", "TrackerIntegrationCode",
    "IntegrationCode", "TrackerCode",
  ]);
  if (direct) return String(direct).trim();

  const listField = item.TrackerIntegrationCodeList || item.trackerIntegrationCodeList;
  if (Array.isArray(listField) && listField.length > 0 && typeof listField[0] === "string") {
    return listField[0].trim();
  }
  const tracker = item.Tracker || item.tracker;
  if (tracker && typeof tracker === "object") {
    const nested = tracker.IntegrationCode || tracker.integrationCode || tracker.Code || tracker.code;
    if (nested && typeof nested === "string") return nested.trim();
  }
  return null;
}

export function pickPlate(item: any): string | null {
  const v = pickFirst(item, ["Plate", "plate", "LicensePlate", "licensePlate", "VehiclePlate", "vehiclePlate"]);
  return v ? String(v).trim() : null;
}

// ======================== HTTP Helpers ========================

export interface SsxHttpResult {
  ok: boolean;
  status: number;
  text: string;
  parsed: any;
  parseError: boolean;
  networkError: string | null;
  durationMs: number;
  errorClass: SsxErrorClass;
}

/**
 * Safe POST with JSON body and timeout.
 * Never throws — returns structured result.
 */
export async function ssxPost(
  endpoint: string,
  token: string,
  body: any | null,
  timeoutMs = 30_000,
): Promise<SsxHttpResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    const init: RequestInit = {
      method: "POST",
      headers,
      signal: controller.signal,
    };
    if (body !== null && body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const resp = await fetch(endpoint, init);
    clearTimeout(timer);
    const text = await resp.text();
    const durationMs = Date.now() - start;

    let parsed: any = null;
    let parseError = false;
    try { parsed = JSON.parse(text); } catch { parseError = text.length > 0; }

    const errorClass = resp.ok ? (parseError ? "parse_error" : "unknown") : classifyError(resp.status, undefined, parseError);
    return { ok: resp.ok, status: resp.status, text, parsed, parseError, networkError: null, durationMs, errorClass };
  } catch (error: any) {
    const durationMs = Date.now() - start;
    const msg = error.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : error.message;
    return { ok: false, status: 0, text: "", parsed: null, parseError: false, networkError: msg, durationMs, errorClass: classifyError(0, msg) };
  }
}

/**
 * Try an endpoint with multiple URL candidates (versioned → unversioned fallback on 404).
 * Tries each URL with each body candidate until success.
 */
export interface EndpointAttemptResult {
  success: boolean;
  items: any[];
  endpoint: string;
  statusCode: number;
  errorClass: SsxErrorClass;
  errorMessage: string | null;
  successfulFormat: string | null;
  attempts: AttemptLog[];
}

export interface AttemptLog {
  endpoint: string;
  format: string;
  statusCode: number;
  errorClass: SsxErrorClass;
  durationMs: number;
  itemCount: number;
  responsePreview: string;
}

/**
 * Body candidates for Administration API endpoints.
 * Per SSX swagger, Administration List endpoints accept:
 * - array of QueryCondition (nullable) — [] for "list all"
 * - null (no body)
 */
export const ADMIN_BODY_CANDIDATES: { label: string; body: any }[] = [
  { label: "empty_array", body: [] },
  { label: "null_body", body: null },
];

export async function tryEndpointWithFallback(params: {
  urlCandidates: string[];
  token: string;
  bodyCandidates: { label: string; body: any }[];
  timeoutMs?: number;
  /** If set, try this (endpoint, format) first */
  memoEndpoint?: string;
  memoFormat?: string;
}): Promise<EndpointAttemptResult> {
  const { urlCandidates, token, bodyCandidates, timeoutMs = 30_000, memoEndpoint, memoFormat } = params;
  const attempts: AttemptLog[] = [];
  let lastStatus = 0;
  let lastErrorClass: SsxErrorClass = "unknown";
  let lastError: string | null = null;

  // Try memoized combination first
  if (memoEndpoint && memoFormat) {
    const candidate = bodyCandidates.find(c => c.label === memoFormat);
    if (candidate) {
      const result = await ssxPost(memoEndpoint, token, candidate.body, timeoutMs);
      const items = result.ok ? extractResponseItems(result.parsed) : [];
      attempts.push(buildAttemptLog(memoEndpoint, `memo:${memoFormat}`, result, items.length));
      if (result.errorClass === "rate_limited") return buildResult(false, [], memoEndpoint, 429, "rate_limited", "Rate limit", null, attempts);
      if (result.errorClass === "auth_error") return buildResult(false, [], memoEndpoint, result.status, "auth_error", "Auth failed", null, attempts);
      if (result.ok && items.length > 0) return buildResult(true, items, memoEndpoint, result.status, "unknown", null, memoFormat, attempts);
    }
  }

  for (const url of urlCandidates) {
    for (const candidate of bodyCandidates) {
      // Skip if already tried as memo
      if (url === memoEndpoint && candidate.label === memoFormat) continue;

      const result = await ssxPost(url, token, candidate.body, timeoutMs);
      const items = result.ok ? extractResponseItems(result.parsed) : [];
      attempts.push(buildAttemptLog(url, candidate.label, result, items.length));

      lastStatus = result.status;
      lastErrorClass = result.errorClass;
      lastError = result.networkError || result.text.substring(0, 200);

      if (result.errorClass === "rate_limited") return buildResult(false, [], url, 429, "rate_limited", "Rate limit", null, attempts);
      if (result.errorClass === "auth_error") return buildResult(false, [], url, result.status, "auth_error", "Auth failed", null, attempts);

      if (result.ok && items.length > 0) return buildResult(true, items, url, result.status, "unknown", null, candidate.label, attempts);

      // 200 with empty list = endpoint works but no data (not a body format issue)
      if (result.ok && items.length === 0) {
        lastErrorClass = "empty_response";
        lastError = "Endpoint returned success but empty list";
        continue; // try next body just in case
      }

      // 404 means this URL doesn't exist, skip to next URL
      if (result.errorClass === "route_not_found") break;

      // 400/415 means body format wrong, try next body
      if (result.errorClass === "body_incompatible") continue;

      // Other errors: try next body
    }
  }

  return buildResult(false, [], urlCandidates[0] || "", lastStatus, lastErrorClass, lastError, null, attempts);
}

// ======================== Logging ========================

export interface IntegrationLogEntry {
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

export async function logIntegration(supabase: any, log: IntegrationLogEntry): Promise<void> {
  try {
    await supabase.from("integration_logs").insert(log);
  } catch (e) {
    console.error("Failed to write integration log:", e);
  }
}

/**
 * Creates a detailed console log entry for an SSX API call.
 * Sanitizes sensitive data (tokens, passwords, secrets).
 */
export function logSsxCall(params: {
  routine: string;
  endpoint: string;
  method: string;
  apiVersion: string;
  attemptType: string;
  payloadPreview?: any;
  statusCode: number;
  durationMs: number;
  responsePreview: string;
  result: "success" | "empty" | "error";
  fallbackReason?: string;
  errorClass?: SsxErrorClass;
}): void {
  const sanitizedPayload = params.payloadPreview ? sanitize(params.payloadPreview) : null;
  console.log(`[SSX:${params.routine}] ${params.method} ${params.endpoint} | v=${params.apiVersion} | type=${params.attemptType} | status=${params.statusCode} | ${params.durationMs}ms | result=${params.result}${params.errorClass ? ` (${params.errorClass})` : ""}${params.fallbackReason ? ` | fallback: ${params.fallbackReason}` : ""} | payload=${JSON.stringify(sanitizedPayload)} | response=${params.responsePreview.substring(0, 150)}`);
}

// ======================== Sanitizer ========================

/** Mask sensitive fields in objects before logging */
export function sanitize(obj: any): any {
  if (obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj !== "object") return obj;

  const sensitiveKeys = new Set([
    "token", "Token", "token_cache", "password", "Password", "password_encrypted",
    "secret", "Secret", "hash", "Hash", "hashauth", "hashcode",
    "Authorization", "authorization", "AccessToken", "access_token",
    "admin_token_cache",
  ]);
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (sensitiveKeys.has(key)) {
      result[key] = typeof val === "string" ? `***${val.slice(-4)}` : "***";
    } else {
      result[key] = sanitize(val);
    }
  }
  return result;
}

// ======================== Auth Helpers ========================

export async function getTenantRole(supabase: any, tenantId: string, userId: string): Promise<string | null> {
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

export async function authenticateCaller(req: Request, supabaseUrl: string, supabaseAnonKey: string, supabaseServiceKey: string): Promise<{
  callerId: string | null;
  isCron: boolean;
  error?: Response;
}> {
  const { createClient } = await import("npm:@supabase/supabase-js@2");

  const cronSecret = req.headers.get("x-agvlog-cron-secret");
  const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
  const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);

  if (isCron) return { callerId: null, isCron: true };

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      callerId: null, isCron: false,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await anonClient.auth.getUser();
  if (userError || !userData?.user) {
    return {
      callerId: null, isCron: false,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  return { callerId: userData.user.id, isCron: false };
}

// ======================== Encryption Helper ========================

export async function decryptAesGcm(encrypted: string, keyHex: string): Promise<string> {
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

// ======================== Internal Helpers ========================

function pickFirst(obj: any, keys: string[]): string | number | null {
  for (const key of keys) {
    const val = obj[key];
    if (val != null && val !== "") {
      if (typeof val === "string" && val.trim()) return val.trim();
      if (typeof val === "number") return val;
    }
  }
  return null;
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (val == null) continue;
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (typeof n === "number" && !isNaN(n)) return n;
  }
  return null;
}

function pickBoolean(obj: any, keys: string[]): boolean | null {
  for (const key of keys) {
    const val = obj[key];
    if (val == null) continue;
    if (typeof val === "boolean") return val;
    if (val === "true" || val === "1" || val === 1) return true;
    if (val === "false" || val === "0" || val === 0) return false;
  }
  return null;
}

function buildAttemptLog(endpoint: string, format: string, result: SsxHttpResult, itemCount: number): AttemptLog {
  return {
    endpoint,
    format,
    statusCode: result.status,
    errorClass: result.ok ? (itemCount > 0 ? "unknown" as SsxErrorClass : "empty_response") : result.errorClass,
    durationMs: result.durationMs,
    itemCount,
    responsePreview: (result.text || result.networkError || "").substring(0, 150),
  };
}

function buildResult(
  success: boolean, items: any[], endpoint: string, statusCode: number,
  errorClass: SsxErrorClass, errorMessage: string | null,
  successfulFormat: string | null, attempts: AttemptLog[],
): EndpointAttemptResult {
  return { success, items, endpoint, statusCode, errorClass, errorMessage, successfulFormat, attempts };
}
