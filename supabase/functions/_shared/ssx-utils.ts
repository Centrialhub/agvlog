import { isCronRequest } from "./cron-auth.ts";
import { corsHeaders } from "./cors.ts";

export { corsHeaders };

/**
 * SSX Integration Shared Utilities
 * 
 * Centralizes URL building, response normalization, error classification,
 * HTTP helpers, and logging for all SSX edge functions.
 * 
 * DESIGN DECISIONS:
 * - Administration API is the PRIMARY source for tracker/vehicle catalogs.
 * - PositionHistory is a FALLBACK only, never the authoritative source.
 * - Administration API may or may not use version prefix — we try BOTH.
 * - Tracking API uses version prefix (e.g., /v3/Tracking/...).
 * - HashAuth in Login scopes the token to Tracking integration only.
 *   Administration endpoints require a token obtained WITHOUT HashAuth.
 *   HOWEVER: some accounts work with the regular token on Admin endpoints.
 *   We try admin token first, then regular token as fallback.
 * - Secrets (token, password, hash) are NEVER logged in plaintext.
 */

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
  const unversioned = `${base}${cleanPath}`;
  if (!urls.includes(unversioned)) urls.push(unversioned);
  return urls;
}

/**
 * Returns ordered endpoint candidates specifically for PositionHistory/List.
 * Order: unversioned FIRST (production-proven), then current apiVersion, then v2.
 * Rationale: production data shows unversioned works; versioned often returns 204 empty.
 */
export function buildPositionHistoryUrlCandidates(baseUrl: string, apiVersion: string): string[] {
  const base = baseUrl.replace(/\/$/, "");
  const path = "/Tracking/PositionHistory/List";
  const ver = (apiVersion || "v3").replace(/^\//, "").replace(/\/$/, "");
  const candidates: string[] = [];
  const add = (url: string) => { if (!candidates.includes(url)) candidates.push(url); };
  add(`${base}${path}`);          // unversioned — proven to work
  add(`${base}/${ver}${path}`);   // current version (e.g. v3)
  add(`${base}/v2${path}`);       // v2 fallback
  return candidates;
}

/**
 * Summarizes polling attempts with item counts for PositionHistory logging.
 */
export function summarizePollingAttempts(attempts: { url: string; property: string; timeProp: string; format: string; statusCode: number; errorClass: string; itemCount: number }[]): string[] {
  return attempts.map(a =>
    `POST ${a.url} [${a.property}|${a.timeProp}|${a.format}] => ${a.statusCode} ${a.errorClass}${a.itemCount > 0 ? ` items=${a.itemCount}` : ""}`
  );
}

/**
 * Builds Administration API URL — NO version prefix.
 * Per SSX swagger, Administration endpoints are at /Administration/... directly.
 */
export function buildAdminUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Returns ordered endpoint candidates for Administration:
 * 1. Unversioned: /Administration/Tracker/List
 * 2. Versioned:   /v3/Administration/Tracker/List
 * No duplicates.
 */
export function buildAdminUrlCandidates(baseUrl: string, apiVersion: string, path: string): string[] {
  const base = baseUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const ver = (apiVersion || "v3").replace(/^\//, "").replace(/\/$/, "");
  const unversioned = `${base}${cleanPath}`;
  const versioned = `${base}/${ver}${cleanPath}`;
  const urls = [unversioned];
  if (versioned !== unversioned) urls.push(versioned);
  return urls;
}

// ======================== Account Config Reader ========================

export interface SsxAccountConfig {
  baseUrl: string;
  apiVersion: string;
  token: string;
  adminToken: string | null;
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
 * If no HashAuth is configured, the regular token works for both.
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
    if (!encryptionKey) {
      return { token: null, error: "AGVLOG_ENCRYPTION_KEY is required" };
    }
    try {
      password = await decryptAesGcm(password, encryptionKey);
    } catch (e: any) {
      console.error("[SSX:admin-token] Decryption failed:", e.message);
      return { token: null, error: `Decryption failed: ${e.message}` };
    }
  }

  const params = new URLSearchParams();
  params.append("Username", config.username);
  params.append("Password", password);
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
    console.log(`[SSX:admin-token] POST ${loginUrl} (no HashAuth) | status=${resp.status} | ${duration}ms`);

    if (!resp.ok) {
      return { token: null, error: `Login without HashAuth failed: HTTP ${resp.status}` };
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

export function isRetryable(errorClass: SsxErrorClass): boolean {
  return ["rate_limited", "timeout", "network_error", "server_error"].includes(errorClass);
}

export function isAuthFailure(errorClass: SsxErrorClass): boolean {
  return errorClass === "auth_error";
}

// ======================== Response Normalizer ========================

/**
 * Extracts the array of items from any SSX API response format.
 * Supports many container key variants and one-level nested scans.
 */
export function extractResponseItems(parsed: any): any[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object") return [];

  const directKeys = [
    "Data", "data", "Items", "items", "Result", "result",
    "Results", "results", "Records", "records",
    "Trackers", "trackers", "Vehicles", "vehicles",
    "Units", "units", "Positions", "positions",
    "Content", "content", "List", "list",
    "TrackedUnits", "trackedUnits",
    "Rows", "rows", "Values", "values",
    "Collection", "collection", "Entities", "entities",
    "Response", "response",
  ];
  for (const key of directKeys) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }

  // One-level nested scan
  const outerKeys = ["Data", "data", "Result", "result", "Content", "content", "Response", "response"];
  for (const outerKey of outerKeys) {
    const outer = parsed[outerKey];
    if (outer && typeof outer === "object" && !Array.isArray(outer)) {
      for (const innerKey of directKeys) {
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
  unit_key_type: "vehicle_integration_code" | "tracked_unit_integration_code" | "tracker_integration_code" | "fallback_position_history";
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
 * Normalizes a raw SSX item into a NormalizedUnit.
 * 
 * external_code priority (VEHICLE-FIRST):
 * 1. VehicleIntegrationCode (from Vehicle/List endpoints)
 * 2. TrackedUnitIntegrationCode
 * 3. TrackerIntegrationCode / IntegrationCode (only if no vehicle/unit code)
 * 4. Code / TrackedUnit / SerialNumber / IMEI (last resort)
 */
export function normalizeTrackerItem(raw: any, sourceEndpoint: string, sourceMode: "admin_catalog" | "tracking_fallback"): NormalizedUnit | null {
  const vehicleCode = pickFirst(raw, ["VehicleIntegrationCode", "vehicleIntegrationCode"]);
  const trackedUnitCode = pickFirst(raw, ["TrackedUnitIntegrationCode", "trackedUnitIntegrationCode"]);
  const trackerCode = pickFirst(raw, ["TrackerIntegrationCode", "trackerIntegrationCode", "IntegrationCode", "integrationCode"]);
  const fallbackCode = pickFirst(raw, ["Code", "code", "TrackedUnit", "trackedUnit", "TrackerCode", "SerialNumber", "IMEI", "Imei"]);

  let externalCode: string | null = null;
  let unitKeyType: NormalizedUnit["unit_key_type"] = "fallback_position_history";

  if (vehicleCode) {
    externalCode = String(vehicleCode).trim();
    unitKeyType = "vehicle_integration_code";
  } else if (trackedUnitCode) {
    externalCode = String(trackedUnitCode).trim();
    unitKeyType = "tracked_unit_integration_code";
  } else if (trackerCode) {
    externalCode = String(trackerCode).trim();
    unitKeyType = "tracker_integration_code";
  } else if (fallbackCode) {
    externalCode = String(fallbackCode).trim();
    unitKeyType = "fallback_position_history";
  }

  if (!externalCode) return null;

  return {
    external_id: pickFirst(raw, ["Id", "id", "TrackerId", "trackerId", "VehicleId", "vehicleId"]) || null,
    external_code: externalCode,
    unit_key_type: unitKeyType,
    tracker_id: pickFirst(raw, ["TrackerId", "trackerId", "TrackerUnitId", "IdTracker", "idTracker"]) || null,
    vehicle_id_external: pickFirst(raw, ["VehicleId", "vehicleId", "IdTrackedUnit", "idTrackedUnit"]) || null,
    name: pickFirst(raw, ["Description", "Name", "Model", "TrackerModel", "name", "description", "TrackedUnit", "trackedUnit"]) || null,
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

export function pickVehicleIntegrationCode(item: any): string | null {
  const direct = pickFirst(item, [
    "VehicleIntegrationCode", "vehicleIntegrationCode",
    "TrackedUnitIntegrationCode", "trackedUnitIntegrationCode",
    "IntegrationCode", "integrationCode",
  ]);
  if (direct) return String(direct).trim();
  return null;
}

export function pickTrackerCodeFromVehicle(item: any): string | null {
  const direct = pickFirst(item, [
    "TrackerIntegrationCode", "trackerIntegrationCode",
    "TrackerCode",
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
 * Safe POST with JSON body and timeout. Never throws.
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

// ======================== Body Candidates ========================

/**
 * Body candidates for Administration API endpoints.
 * SSX Administration List endpoints accept various formats.
 * We try multiple because different SSX versions/configs accept different bodies.
 * 
 * NOTE: 403 from SSX admin can mean "wrong body format" not just "no permission",
 * so we try ALL formats before concluding it's truly an auth error.
 */
/**
 * Body candidates for Administration API endpoints.
 * Swagger shows Admin List endpoints accept QueryCondition[] (array).
 * We try [] first (swagger-aligned), then defensive fallbacks.
 */
export const ADMIN_BODY_CANDIDATES: { label: string; body: any }[] = [
  { label: "empty_array", body: [] },
  { label: "null_body", body: null },
  { label: "empty_object", body: {} },
  { label: "wrapped_empty_filters", body: { Filters: [] } },
  { label: "paginated", body: { Page: 1, PageSize: 500 } },
];

/**
 * Body candidates for Tracking API endpoints (TrackedUnit/List, etc.)
 */
export const TRACKING_BODY_CANDIDATES: { label: string; body: any }[] = [
  { label: "empty_array", body: [] },
  { label: "null_body", body: null },
  { label: "empty_object", body: {} },
  { label: "wrapped_empty_filters", body: { Filters: [] } },
  { label: "paginated", body: { Page: 1, PageSize: 500 } },
];

/**
 * Body candidates specifically for Tracking list endpoints that accept filters
 * (e.g., PositionHistory/List). Uses __UNIT_CODE__ as placeholder for substitution.
 */
export const TRACKING_LIST_BODY_CANDIDATES: { label: string; body: any }[] = [
  { label: "array_empty", body: [] },
  { label: "array_tracked_unit_code_placeholder", body: [{ PropertyName: "TrackedUnitIntegrationCode", Condition: "=", Value: "__UNIT_CODE__" }] },
  { label: "wrapped_filters", body: { Filters: [{ PropertyName: "TrackedUnitIntegrationCode", Condition: "=", Value: "__UNIT_CODE__" }] } },
];

/**
 * Default filter property candidates for PositionHistory — order matters.
 * TrackedUnitIntegrationCode is the swagger-documented property name.
 */
export const POSITION_FILTER_PROPERTY_CANDIDATES = [
  "TrackedUnitIntegrationCode",
  "TrackedUnit",
  "TrackerIntegrationCode",
  "IntegrationCode",
];

/**
 * Default time filter property candidates for PositionHistory.
 * EventDate is the swagger-documented field; DateTimeGPS is a legacy alias.
 */
export const TIME_FILTER_PROPERTY_CANDIDATES = [
  "EventDate",
  "UpdateDate",
  "DateTimeGPS",
];

// ======================== Endpoint Discovery ========================

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
 * Try an endpoint with multiple URL candidates and body candidates.
 * 
 * Error classification priority (derived from actual attempts):
 * 1. rate_limited — abort immediately
 * 2. If any attempt succeeded with items — return success
 * 3. If all failed: classify based on DOMINANT failure pattern
 *    - If any was 404 → route_not_found
 *    - If any was 400/415 → body_incompatible
 *    - If any was 401/403 → auth_error
 *    - If any was timeout/network → timeout/network_error
 *    - If all returned empty 200 → empty_response
 *    - Otherwise → unknown
 */
export async function tryEndpointWithFallback(params: {
  urlCandidates: string[];
  token: string;
  bodyCandidates: { label: string; body: any }[];
  timeoutMs?: number;
  memoEndpoint?: string;
  memoFormat?: string;
  /** If false, don't abort on 403 — try all body formats first (for admin endpoints) */
  abortOnAuthError?: boolean;
}): Promise<EndpointAttemptResult> {
  const { urlCandidates, token, bodyCandidates, timeoutMs = 30_000, memoEndpoint, memoFormat, abortOnAuthError = true } = params;
  const attempts: AttemptLog[] = [];

  // Try memoized combination first
  if (memoEndpoint && memoFormat) {
    const candidate = bodyCandidates.find(c => c.label === memoFormat);
    if (candidate) {
      const result = await ssxPost(memoEndpoint, token, candidate.body, timeoutMs);
      const items = result.ok ? extractResponseItems(result.parsed) : [];
      attempts.push(buildAttemptLog(memoEndpoint, `memo:${memoFormat}`, result, items.length));
      if (result.errorClass === "rate_limited") return buildResult(false, [], memoEndpoint, 429, "rate_limited", "Rate limit", null, attempts);
      if (result.ok && items.length > 0) return buildResult(true, items, memoEndpoint, result.status, "unknown", null, memoFormat, attempts);
    }
  }

  for (const url of urlCandidates) {
    for (const candidate of bodyCandidates) {
      if (url === memoEndpoint && candidate.label === memoFormat) continue;

      const result = await ssxPost(url, token, candidate.body, timeoutMs);
      const items = result.ok ? extractResponseItems(result.parsed) : [];
      attempts.push(buildAttemptLog(url, candidate.label, result, items.length));

      if (result.errorClass === "rate_limited") return buildResult(false, [], url, 429, "rate_limited", "Rate limit", null, attempts);

      // On 403: if abortOnAuthError=true, abort. Otherwise, try next body format.
      if (result.errorClass === "auth_error") {
        if (abortOnAuthError) {
          return buildResult(false, [], url, result.status, "auth_error", "Auth failed", null, attempts);
        }
        continue;
      }

      if (result.ok && items.length > 0) return buildResult(true, items, url, result.status, "unknown", null, candidate.label, attempts);

      if (result.ok && items.length === 0) continue; // empty response, try next

      if (result.errorClass === "route_not_found") break; // URL doesn't exist, try next URL

      if (result.errorClass === "body_incompatible") continue; // try next body
    }
  }

  // All attempts exhausted — derive the BEST real error classification
  const finalResult = deriveErrorFromAttempts(attempts, urlCandidates[0] || "");
  return finalResult;
}

/**
 * Derives the real error classification from the full attempt matrix.
 * Priority: route_not_found > body_incompatible > auth_error > timeout > empty_response > unknown
 */
function deriveErrorFromAttempts(attempts: AttemptLog[], fallbackEndpoint: string): EndpointAttemptResult {
  if (attempts.length === 0) {
    return buildResult(false, [], fallbackEndpoint, 0, "unknown", "No attempts made", null, attempts);
  }

  const classes = new Set(attempts.map(a => a.errorClass));
  const lastAttempt = attempts[attempts.length - 1];

  // Check if ALL were empty_response (200 but no items)
  const allEmpty = attempts.every(a => a.errorClass === "empty_response");
  if (allEmpty) {
    return buildResult(false, [], lastAttempt.endpoint, 200, "empty_response",
      "All endpoints returned success but empty list", null, attempts);
  }

  // Priority-based classification from actual failures
  let bestClass: SsxErrorClass = "unknown";
  let bestMessage = "All attempts failed";
  let bestEndpoint = lastAttempt.endpoint;
  let bestStatus = lastAttempt.statusCode;

  if (classes.has("route_not_found")) {
    bestClass = "route_not_found";
    bestMessage = "Endpoint(s) returned 404";
    const match = attempts.find(a => a.errorClass === "route_not_found");
    if (match) { bestEndpoint = match.endpoint; bestStatus = match.statusCode; }
  } else if (classes.has("body_incompatible")) {
    bestClass = "body_incompatible";
    bestMessage = "All body formats rejected (400/415)";
    const match = attempts.find(a => a.errorClass === "body_incompatible");
    if (match) { bestEndpoint = match.endpoint; bestStatus = match.statusCode; }
  } else if (classes.has("auth_error")) {
    bestClass = "auth_error";
    bestMessage = "Authentication failed on all attempts (401/403)";
    const match = attempts.find(a => a.errorClass === "auth_error");
    if (match) { bestEndpoint = match.endpoint; bestStatus = match.statusCode; }
  } else if (classes.has("timeout") || classes.has("network_error")) {
    bestClass = classes.has("timeout") ? "timeout" : "network_error";
    bestMessage = "Network/timeout error";
    const match = attempts.find(a => a.errorClass === "timeout" || a.errorClass === "network_error");
    if (match) { bestEndpoint = match.endpoint; bestStatus = match.statusCode; }
  } else if (classes.has("server_error")) {
    bestClass = "server_error";
    bestMessage = "Server error (5xx)";
    const match = attempts.find(a => a.errorClass === "server_error");
    if (match) { bestEndpoint = match.endpoint; bestStatus = match.statusCode; }
  }

  return buildResult(false, [], bestEndpoint, bestStatus, bestClass, bestMessage, null, attempts);
}

/**
 * Summarizes the attempt matrix into human-readable strings for logs/diagnostic.
 */
export function summarizeAttemptMatrix(attempts: AttemptLog[]): string[] {
  return attempts.map(a =>
    `POST ${a.endpoint} [${a.format}] => ${a.statusCode} ${a.errorClass}${a.itemCount > 0 ? ` (${a.itemCount} items)` : ""}`
  );
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
  metadata?: Record<string, unknown>;
}

export async function logIntegration(supabase: any, log: IntegrationLogEntry): Promise<void> {
  try {
    await supabase.from("integration_logs").insert(log);
  } catch (e) {
    console.error("Failed to write integration log:", e);
  }
}

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
  console.log(`[SSX:${params.routine}] ${params.method} ${params.endpoint} | v=${params.apiVersion} | type=${params.attemptType} | status=${params.statusCode} | ${params.durationMs}ms | result=${params.result}${params.errorClass ? ` (${params.errorClass})` : ""}${params.fallbackReason ? ` | fallback: ${params.fallbackReason}` : ""}`);
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
  const { createClient } = await import("@supabase/supabase-js");

  const isCron = await isCronRequest(req, supabaseUrl, supabaseServiceKey);

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
