/**
 * ssx-insert-person — Inserts a driver/person into SSX via Tracking API.
 * Uses buildSsxUrlCandidates for versioned + unversioned fallback.
 * Payload aligned with SSX swagger PersonInsert schema.
 * Preserves real error classification in logs.
 */

import { createClient } from "@supabase/supabase-js";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders,
  buildSsxUrlCandidates,
  readAccountConfig,
  ssxPost,
  logIntegration,
  logSsxCall,
  summarizeAttemptMatrix,
  getTenantRole,
  type AttemptLog,
  type SsxHttpResult,
} from "../_shared/ssx-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const callerId = userData.user.id;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, driver_id, integration_account_id } = await req.json();
    if (!tenant_id || !driver_id || !integration_account_id) {
      return jsonResp({ error: "tenant_id, driver_id, and integration_account_id required" }, 400);
    }

    const role = await getTenantRole(supabase, tenant_id, callerId);
    if (!role || !["owner", "admin"].includes(role)) {
      return jsonResp({ error: "Forbidden" }, 403);
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const { data: driver, error: driverErr } = await supabase
      .from("drivers").select("*").eq("id", driver_id).eq("tenant_id", tenant_id).single();
    if (driverErr || !driver) {
      return jsonResp({ error: "Driver not found" }, 404);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).eq("tenant_id", tenant_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    if (!account.token_cache || !account.token_expires_at || new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
    }

    const config = readAccountConfig(account);
    const settings = config.settings;

    // Validate required fields
    if (!driver.name || !driver.name.trim()) {
      return jsonResp({ error: "Driver name is required for SSX InsertPerson" }, 400);
    }

    // Build swagger-aligned PersonInsert payload
    const personPayload: Record<string, unknown> = {
      Name: driver.name.trim(),
    };

    // Map available driver fields to SSX schema
    if (driver.doc) personPayload.CPF = driver.doc;
    if (driver.phone) {
      personPayload.CellPhoneNumber = driver.phone;
      personPayload.PhoneNumber = driver.phone;
    }

    // PersonIntegrationCode — use driver ID or doc as unique code
    personPayload.PersonIntegrationCode = driver.doc || driver.id;

    // IDCard — use doc if available
    if (driver.doc) personPayload.IDCard = driver.doc;

    // Account-level defaults from settings
    if (settings.organization_unit_integration_code) {
      personPayload.OrganizationUnitIntegrationCode = settings.organization_unit_integration_code;
    }
    if (settings.person_role_integration_code) {
      personPayload.PersonRoleIntegrationCode = settings.person_role_integration_code;
    }
    if (settings.work_schedule_integration_code) {
      personPayload.WorkScheduleIntegrationCode = settings.work_schedule_integration_code;
    }
    if (settings.user_profile_template_integration_code) {
      personPayload.UserProfileTemplateIntegrationCode = settings.user_profile_template_integration_code;
    }
    if (settings.default_country) personPayload.Country = settings.default_country;
    if (settings.default_language) personPayload.Language = settings.default_language;
    if (settings.default_timezone) personPayload.TimeZone = settings.default_timezone;

    // Optional fields from driver metadata if present
    const meta = driver.metadata && typeof driver.metadata === "object"
      ? driver.metadata as Record<string, unknown>
      : {};
    if (meta.email) personPayload.Email = meta.email;
    if (meta.date_of_birth) personPayload.DateOfBirth = meta.date_of_birth;
    if (meta.gender) personPayload.Gender = meta.gender;
    if (meta.registration) personPayload.Registration = meta.registration;
    if (meta.license_driver) personPayload.LicenseDriver = meta.license_driver;
    if (meta.expiration_date_license) personPayload.ExpirationDateLicenseDriver = meta.expiration_date_license;
    if (meta.emission_date_license) personPayload.EmissionDateLicenseDriver = meta.emission_date_license;
    if (meta.first_date_license) personPayload.FirstDateLicenseDriver = meta.first_date_license;
    if (meta.login) personPayload.Login = meta.login;
    if (meta.password) personPayload.Password = meta.password;

    // Try versioned first, then unversioned on 404
    const insertUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/Person/InsertPerson");
    const allAttempts: AttemptLog[] = [];

    let resp: SsxHttpResult | null = null;
    let usedUrl = insertUrls[0];

    for (const url of insertUrls) {
      resp = await ssxPost(url, config.token, personPayload, config.requestTimeoutMs);
      usedUrl = url;

      allAttempts.push({
        endpoint: url, format: "person_payload",
        statusCode: resp.status, errorClass: resp.ok ? "unknown" : resp.errorClass,
        durationMs: resp.durationMs, itemCount: resp.ok ? 1 : 0,
        responsePreview: (resp.text || "").substring(0, 150),
      });

      logSsxCall({
        routine: "insert-person", endpoint: url, method: "POST",
        apiVersion: config.apiVersion, attemptType: "insert_person",
        statusCode: resp.status, durationMs: resp.durationMs,
        responsePreview: (resp.text || "").substring(0, 150),
        result: resp.ok ? "success" : "error",
        errorClass: resp.errorClass,
      });

      if (resp.ok) break;
      // If 404, try next URL candidate
      if (resp.errorClass === "route_not_found") continue;
      // For other errors, stop
      break;
    }

    if (!resp || !resp.ok) {
      await supabase.from("drivers").update({ provider_person_sync_status: "error" }).eq("id", driver_id);

      await logIntegration(supabase, {
        tenant_id, integration_account_id,
        action: "ssx_insert_person", endpoint: usedUrl,
        status_code: resp?.status || 0, success: false,
        error_message: resp?.text?.substring(0, 500) || "No response",
        duration_ms: resp?.durationMs || 0,
        metadata: {
          error_class: resp?.errorClass || "unknown",
          endpoint_candidates: insertUrls,
          attempt_matrix: summarizeAttemptMatrix(allAttempts),
        },
      });

      return jsonResp({
        error: "SSX insert person failed", status_code: resp?.status || 0,
        error_class: resp?.errorClass || "unknown",
        details: resp?.text?.substring(0, 200) || "No response",
      }, 502);
    }

    let personId: string | null = null;
    try {
      const parsed = resp.parsed;
      personId = String(parsed?.Id || parsed?.id || parsed?.PersonId || parsed?.personId || "");
    } catch {
      personId = resp.text.trim();
    }

    await supabase.from("drivers").update({
      provider_person_id: personId || null,
      provider_person_sync_status: "synced",
    }).eq("id", driver_id);

    await logIntegration(supabase, {
      tenant_id, integration_account_id,
      action: "ssx_insert_person", endpoint: usedUrl,
      status_code: resp.status, success: true,
      duration_ms: resp.durationMs,
      metadata: {
        driver_id, person_id: personId,
        final_successful_endpoint: usedUrl,
        endpoint_candidates: insertUrls,
        attempt_matrix: summarizeAttemptMatrix(allAttempts),
      },
    });

    return jsonResp({ success: true, person_id: personId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[SSX:insert-person] error:", err);
    return jsonResp({ error: "Internal error", details: message }, 500);
  }
});

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
