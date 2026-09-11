/**
 * Reconciles one real driver with the SSX Tracking Person contract.
 * The stable integration identity is always the AGVLog driver UUID.
 */

import { createClient } from "@supabase/supabase-js";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import { requireActiveTenant } from "../_shared/active-tenant.ts";
import {
  buildTrackingUrl,
  corsHeaders,
  getTenantRole,
  logIntegration,
  logSsxCall,
  readAccountConfig,
  redactedSsxResponsePreview,
  ssxPost,
  type SsxHttpResult,
} from "../_shared/ssx-utils.ts";

type JsonObject = Record<string, unknown>;

interface RemotePerson extends JsonObject {
  PersonIntegrationCodeClient?: unknown;
  PersonRoleIntegrationCode?: unknown;
}

interface RemotePersonRole extends JsonObject {
  PersonRoleIntegrationCode?: unknown;
}

interface DriverRecord extends JsonObject {
  id: string;
  tenant_id: string;
  name: string;
  active?: boolean;
  cpf?: string | null;
  doc?: string | null;
  rg?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  birth_date?: string | null;
  sex?: string | null;
  cnh_number?: string | null;
  cnh_expiry?: string | null;
  cnh_issued_at?: string | null;
  first_license_date?: string | null;
  card_number?: string | null;
  registration_date?: string | null;
}

interface CallResult {
  response: SsxHttpResult;
  endpoint: string;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function digits(value: unknown, maxLength: number): string | null {
  const normalized = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function mapBrazilianCellphone(value: unknown): JsonObject | null {
  let normalized = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (normalized.startsWith("55") && (normalized.length === 12 || normalized.length === 13)) {
    normalized = normalized.slice(2);
  }
  if (normalized.length !== 10 && normalized.length !== 11) return null;
  return {
    CountryCode: "55",
    AreaCode: normalized.slice(0, 2),
    CellPhoneNumber: normalized.slice(2),
  };
}

function asRemotePeople(value: unknown): RemotePerson[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is RemotePerson => objectValue(item) !== null);
}

function asRemoteRoles(value: unknown): RemotePersonRole[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is RemotePersonRole => objectValue(item) !== null);
}

function buildPersonPayload(driver: DriverRecord, settings: JsonObject): JsonObject | null {
  const name = stringValue(driver.name)?.slice(0, 100);
  if (!name) return null;

  const payload: JsonObject = {
    PersonIntegrationCode: driver.id,
    Name: name,
  };
  const cpf = digits(driver.cpf, 11) ?? digits(driver.doc, 11);
  if (cpf?.length === 11) payload.CPF = cpf;
  const idCard = digits(driver.rg, 15) ?? (cpf ? null : digits(driver.doc, 15));
  if (idCard) payload.IDCard = idCard;

  const email = stringValue(driver.email)?.slice(0, 150) ?? null;
  if (email) payload.Email = email;
  const mobile = mapBrazilianCellphone(driver.mobile ?? driver.phone);
  if (mobile) Object.assign(payload, mobile);
  if (!email && !mobile) return null;

  const birthDate = dateOnly(driver.birth_date);
  if (birthDate) payload.DateOfBirth = birthDate;
  const gender = stringValue(driver.sex)?.toUpperCase();
  if (gender === "M" || gender === "F") payload.Gender = gender;
  const license = stringValue(driver.cnh_number)?.slice(0, 15);
  if (license) payload.LicenseDriver = license;
  const licenseExpiry = dateOnly(driver.cnh_expiry);
  if (licenseExpiry) payload.ExpirationDateLicenseDriver = licenseExpiry;
  const licenseIssued = dateOnly(driver.cnh_issued_at);
  if (licenseIssued) payload.EmissionDateLicenseDriver = licenseIssued;
  const firstLicense = dateOnly(driver.first_license_date);
  if (firstLicense) payload.FirstDateLicenseDriver = firstLicense;
  const registration = stringValue(driver.registration_date)?.slice(0, 15);
  if (registration) payload.Registration = registration;
  const accessCode = stringValue(driver.card_number)?.slice(0, 16);
  if (accessCode) payload.AccessCode = accessCode;

  const optionalTextSettings: Array<[string, string, number]> = [
    ["organization_unit_integration_code", "OrganizationUnitIntegrationCode", 40],
    ["person_role_integration_code", "PersonRoleIntegrationCode", 40],
    ["work_schedule_integration_code", "WorkScheduleIntegrationCode", 40],
  ];
  for (const [source, target, maxLength] of optionalTextSettings) {
    const value = stringValue(settings[source]);
    if (value) payload[target] = value.slice(0, maxLength);
  }
  const numberSettings: Array<[string, string, number, number]> = [
    ["default_country", "Country", 1, 255],
    ["default_language", "Language", 1, 3],
    ["default_timezone", "TimeZone", 1, 32],
  ];
  for (const [source, target, minimum, maximum] of numberSettings) {
    const value = Number(settings[source]);
    if (Number.isInteger(value) && value >= minimum && value <= maximum) payload[target] = value;
  }
  return payload;
}

async function callSsx(
  endpoint: string,
  token: string,
  body: unknown,
  timeoutMs: number,
  attemptType: string,
): Promise<CallResult> {
  const response = await ssxPost(endpoint, token, body, timeoutMs);
  logSsxCall({
    routine: "reconcile-person",
    endpoint,
    method: "POST",
    apiVersion: "v1",
    attemptType,
    statusCode: response.status,
    durationMs: response.durationMs,
    responsePreview: redactedSsxResponsePreview(response.text, response.networkError),
    result: response.ok ? "success" : "error",
    errorClass: response.errorClass,
  });
  return { response, endpoint };
}

async function setDriverStatus(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  driverId: string,
  status: string,
  providerPersonId: string | null = null,
) {
  const { error } = await admin.from("drivers").update({
    provider_person_id: providerPersonId,
    provider_person_sync_status: status,
  }).eq("id", driverId).eq("tenant_id", tenantId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const body = await req.json() as JsonObject;
    const tenantId = stringValue(body.tenant_id);
    const driverId = stringValue(body.driver_id);
    const accountId = stringValue(body.integration_account_id);
    if (!tenantId || !driverId || !accountId) {
      return jsonResp({ error: "tenant_id, driver_id, and integration_account_id required" }, 400);
    }
    const tenantContextError = requireActiveTenant(req, tenantId);
    if (tenantContextError) return tenantContextError;

    const admin = createClient(supabaseUrl, serviceKey);
    const role = await getTenantRole(admin, tenantId, userData.user.id);
    if (!role || !["owner", "admin"].includes(role)) return jsonResp({ error: "Forbidden" }, 403);
    const capabilityResponse = await requireIntegrationCapability(admin, tenantId, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const [{ data: driverData, error: driverError }, { data: account, error: accountError }, workspace] =
      await Promise.all([
        admin.from("drivers").select("*").eq("id", driverId).eq("tenant_id", tenantId).single(),
        admin.from("integration_accounts").select("*").eq("id", accountId).single(),
        admin.rpc("integration_account_matches_tenant_workspace_v1", {
          _tenant_id: tenantId,
          _integration_account_id: accountId,
        }),
      ]);
    if (driverError || !driverData) return jsonResp({ error: "Driver not found" }, 404);
    if (accountError || !account || workspace.error || workspace.data !== true) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }
    if (!account.token_cache || !account.token_expires_at ||
      new Date(account.token_expires_at).getTime() <= Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 409);
    }

    const driver = driverData as DriverRecord;
    const config = readAccountConfig(account);
    const payload = buildPersonPayload(driver, config.settings);
    if (!payload) {
      await setDriverStatus(admin, tenantId, driverId, "needs_contact");
      return jsonResp({
        error: "SSX_PERSON_CONTACT_REQUIRED",
        message: "O SSX exige e-mail ou celular válido para sincronizar a pessoa.",
      }, 409);
    }

    const listEndpoint = buildTrackingUrl(config.baseUrl, "/Tracking/Person/ListPerson");
    const listed = await callSsx(
      listEndpoint,
      config.token,
      null,
      config.requestTimeoutMs,
      "list_person",
    );
    const remotePeople = listed.response.status === 204 ? [] : asRemotePeople(listed.response.parsed);
    if (!listed.response.ok || !remotePeople) {
      await setDriverStatus(admin, tenantId, driverId, "error");
      return jsonResp({
        error: "SSX_PERSON_LIST_FAILED",
        error_class: listed.response.errorClass,
      }, 502);
    }

    const existing = remotePeople.find((person) =>
      stringValue(person.PersonIntegrationCodeClient) === driver.id
    );
    let action: "insert" | "update" = existing ? "update" : "insert";
    if (existing) {
      const effectiveRole = stringValue(config.settings.person_role_integration_code) ??
        stringValue(existing.PersonRoleIntegrationCode);
      if (!effectiveRole) {
        await setDriverStatus(admin, tenantId, driverId, "needs_role");
        return jsonResp({ error: "SSX_PERSON_ROLE_REQUIRED_FOR_UPDATE" }, 409);
      }

      const roleEndpoint = buildTrackingUrl(config.baseUrl, "/Tracking/Person/ListPersonRole");
      const listedRoles = await callSsx(
        roleEndpoint,
        config.token,
        null,
        config.requestTimeoutMs,
        "list_person_role",
      );
      const roles = listedRoles.response.status === 204 ? [] : asRemoteRoles(listedRoles.response.parsed);
      const roleExists = roles?.some((personRole) =>
        stringValue(personRole.PersonRoleIntegrationCode) === effectiveRole
      ) === true;
      if (!listedRoles.response.ok || !roles) {
        await setDriverStatus(admin, tenantId, driverId, "error");
        return jsonResp({ error: "SSX_PERSON_ROLE_LIST_FAILED" }, 502);
      }
      if (!roleExists) {
        await setDriverStatus(admin, tenantId, driverId, "needs_role");
        return jsonResp({ error: "SSX_PERSON_ROLE_NOT_FOUND" }, 409);
      }
      payload.PersonRoleIntegrationCode = effectiveRole;
      payload.InsertIfNotExists = false;
    }

    await setDriverStatus(admin, tenantId, driverId, "sent");
    const mutationEndpoint = buildTrackingUrl(
      config.baseUrl,
      action === "insert" ? "/Tracking/Person/InsertPerson" : "/Tracking/Person/UpdatePerson",
    );
    const mutation = await callSsx(
      mutationEndpoint,
      config.token,
      payload,
      config.requestTimeoutMs,
      action === "insert" ? "insert_person" : "update_person",
    );
    const result = objectValue(mutation.response.parsed);
    const returnedCode = stringValue(result?.PersonIntegrationCode);
    const centralCode = stringValue(result?.PersonIntegrationCodeCentral);
    if (!mutation.response.ok || returnedCode !== driver.id) {
      await setDriverStatus(admin, tenantId, driverId, "pending_confirmation");
      await logIntegration(admin, {
        tenant_id: tenantId,
        integration_account_id: accountId,
        action: `ssx_${action}_person`,
        endpoint: mutation.endpoint,
        status_code: mutation.response.status,
        success: false,
        error_message: "SSX person mutation was not confirmed by integration code",
        duration_ms: mutation.response.durationMs,
        metadata: { driver_id: driverId, error_class: mutation.response.errorClass },
      });
      return jsonResp({
        error: "SSX_PERSON_CONFIRMATION_REQUIRED",
        error_class: mutation.response.errorClass,
      }, 502);
    }

    await setDriverStatus(admin, tenantId, driverId, "synced", centralCode ?? returnedCode);
    await logIntegration(admin, {
      tenant_id: tenantId,
      integration_account_id: accountId,
      action: `ssx_${action}_person`,
      endpoint: mutation.endpoint,
      status_code: mutation.response.status,
      success: true,
      duration_ms: mutation.response.durationMs,
      metadata: { driver_id: driverId, action },
    });
    return jsonResp({ success: true, action, person_integration_code: returnedCode });
  } catch (error: unknown) {
    console.error("[SSX:reconcile-person] internal failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return jsonResp({ error: "Internal error" }, 500);
  }
});
