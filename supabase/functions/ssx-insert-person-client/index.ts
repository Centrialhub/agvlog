/**
 * ssx-insert-person-client — Sincroniza um cliente (destinatário) com a SSX
 * via Tracking/Person/InsertPerson, criando ou atualizando a pessoa.
 *
 * Espelha o padrão de ssx-insert-person (drivers), mas mapeando os campos do
 * cadastro de cliente: razão social, CNPJ/CPF, IE, endereço, contato, etc.
 *
 * Body: { tenant_id, client_id, integration_account_id }
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
    if (userError || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const callerId = userData.user.id;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, client_id, integration_account_id } = await req.json();
    if (!tenant_id || !client_id || !integration_account_id) {
      return jsonResp({ error: "tenant_id, client_id and integration_account_id required" }, 400);
    }

    const role = await getTenantRole(supabase, tenant_id, callerId);
    if (!role || !["owner", "admin", "operator"].includes(role)) {
      return jsonResp({ error: "Forbidden" }, 403);
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const { data: client, error: clientErr } = await supabase
      .from("clients").select("*").eq("id", client_id).eq("tenant_id", tenant_id).single();
    if (clientErr || !client) return jsonResp({ error: "Client not found" }, 404);

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).eq("tenant_id", tenant_id).single();
    if (accErr || !account) return jsonResp({ error: "Integration account not found" }, 404);

    if (!account.token_cache || !account.token_expires_at || new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
    }

    const config = readAccountConfig(account);
    const settings = config.settings;

    const name = (client.legal_name || client.company_name || "").trim();
    if (!name) return jsonResp({ error: "Client name is required for SSX InsertPerson" }, 400);

    const onlyDigits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
    const docDigits = onlyDigits(client.tax_id);
    const isCpf = docDigits.length === 11;

    // Payload alinhado ao schema PersonInsert do SSX (campos compatíveis)
    const personPayload: Record<string, unknown> = {
      Name: name,
      PersonIntegrationCode: client.internal_code || client.id,
    };
    if (docDigits) {
      if (isCpf) personPayload.CPF = docDigits;
      else personPayload.CNPJ = docDigits;
      personPayload.IDCard = docDigits;
    }
    if (client.trade_name) personPayload.TradeName = client.trade_name;
    if (client.email) personPayload.Email = client.email;
    if (client.phone) personPayload.PhoneNumber = client.phone;
    if (client.mobile) personPayload.CellPhoneNumber = client.mobile;
    if (client.state_registration && client.state_registration !== "UNKNOWN") {
      personPayload.StateRegistration = client.state_registration;
    }
    if (client.municipal_registration) personPayload.MunicipalRegistration = client.municipal_registration;

    // Endereço — campos comuns de Person no SSX
    if (client.address_street) personPayload.Address = client.address_street;
    if (client.address_number) personPayload.AddressNumber = client.address_number;
    if (client.address_complement) personPayload.AddressComplement = client.address_complement;
    if (client.address_neighborhood) personPayload.Neighborhood = client.address_neighborhood;
    if (client.address_city) personPayload.City = client.address_city;
    if (client.address_state) personPayload.State = client.address_state;
    if (client.address_zip) personPayload.ZipCode = onlyDigits(client.address_zip);
    if (client.address_city_ibge_code) personPayload.CityIntegrationCode = client.address_city_ibge_code;
    if (client.address_country_name || client.country_name) {
      personPayload.Country = client.address_country_name || client.country_name;
    }

    // Defaults da conta SSX
    if (settings.organization_unit_integration_code) personPayload.OrganizationUnitIntegrationCode = settings.organization_unit_integration_code;
    if (settings.client_person_role_integration_code || settings.person_role_integration_code) {
      personPayload.PersonRoleIntegrationCode = settings.client_person_role_integration_code || settings.person_role_integration_code;
    }
    if (settings.default_country) personPayload.Country = personPayload.Country || settings.default_country;
    if (settings.default_language) personPayload.Language = settings.default_language;
    if (settings.default_timezone) personPayload.TimeZone = settings.default_timezone;

    const insertUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/Person/InsertPerson");
    const allAttempts: AttemptLog[] = [];
    let resp: SsxHttpResult | null = null;
    let usedUrl = insertUrls[0];

    for (const url of insertUrls) {
      resp = await ssxPost(url, config.token, personPayload, config.requestTimeoutMs);
      usedUrl = url;
      allAttempts.push({
        endpoint: url, format: "client_person_payload",
        statusCode: resp.status, errorClass: resp.ok ? "unknown" : resp.errorClass,
        durationMs: resp.durationMs, itemCount: resp.ok ? 1 : 0,
        responsePreview: (resp.text || "").substring(0, 150),
      });
      logSsxCall({
        routine: "insert-person-client", endpoint: url, method: "POST",
        apiVersion: config.apiVersion, attemptType: "insert_person_client",
        statusCode: resp.status, durationMs: resp.durationMs,
        responsePreview: (resp.text || "").substring(0, 150),
        result: resp.ok ? "success" : "error",
        errorClass: resp.errorClass,
      });
      if (resp.ok) break;
      if (resp.errorClass === "route_not_found") continue;
      break;
    }

    if (!resp || !resp.ok) {
      await supabase.from("clients").update({
        provider_person_sync_status: "error",
        provider_person_synced_at: new Date().toISOString(),
        provider_person_integration_account_id: integration_account_id,
      }).eq("id", client_id);

      await logIntegration(supabase, {
        tenant_id, integration_account_id,
        action: "ssx_insert_person_client", endpoint: usedUrl,
        status_code: resp?.status || 0, success: false,
        error_message: resp?.text?.substring(0, 500) || "No response",
        duration_ms: resp?.durationMs || 0,
        metadata: {
          client_id,
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
      personId = (resp.text || "").trim();
    }

    await supabase.from("clients").update({
      provider_person_id: personId || null,
      provider_person_sync_status: "synced",
      provider_person_synced_at: new Date().toISOString(),
      provider_person_integration_account_id: integration_account_id,
    }).eq("id", client_id);

    await logIntegration(supabase, {
      tenant_id, integration_account_id,
      action: "ssx_insert_person_client", endpoint: usedUrl,
      status_code: resp.status, success: true,
      duration_ms: resp.durationMs,
      metadata: {
        client_id, person_id: personId,
        final_successful_endpoint: usedUrl,
        endpoint_candidates: insertUrls,
        attempt_matrix: summarizeAttemptMatrix(allAttempts),
      },
    });

    return jsonResp({ success: true, person_id: personId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[SSX:insert-person-client] error:", err);
    return jsonResp({ error: "Internal error", details: message }, 500);
  }
});

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
