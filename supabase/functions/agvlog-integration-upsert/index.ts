import { createClient } from "@supabase/supabase-js";
import { corsHeaders as defaultCorsHeaders } from "../_shared/cors.ts";
import { requireActiveTenant } from "../_shared/active-tenant.ts";
import { normalizeSsxBaseUrl } from "../_shared/ssx-utils.ts";

type JsonObject = Record<string, unknown>;

const SSX_CREDENTIAL_PREVIEW_ORIGIN =
  "https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site";

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("Origin");
  const corsHeaders = requestOrigin === SSX_CREDENTIAL_PREVIEW_ORIGIN
    ? { ...defaultCorsHeaders, "Access-Control-Allow-Origin": requestOrigin }
    : defaultCorsHeaders;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const encryptionKey = Deno.env.get("AGVLOG_ENCRYPTION_KEY");

    if (!encryptionKey) {
      return new Response(JSON.stringify({ error: "AGVLOG_ENCRYPTION_KEY is required" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub as string;
    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      tenant_id, base_url, username, password, hashauth, hashcode, id,
      administration_enabled, organization_unit_integration_code,
      person_role_integration_code, work_schedule_integration_code,
    } = await req.json();
    if (!tenant_id || !username || !password) {
      return new Response(
        JSON.stringify({ error: "tenant_id, username, password required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (typeof username !== "string" || username.length < 5 || username.length > 150) {
      return new Response(JSON.stringify({ error: "SSX username must contain 5 to 150 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 20) {
      return new Response(JSON.stringify({ error: "SSX password must contain 6 to 20 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (administration_enabled !== undefined && typeof administration_enabled !== "boolean") {
      return new Response(JSON.stringify({ error: "administration_enabled must be boolean" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (hashauth !== undefined && hashauth !== null && typeof hashauth !== "string") {
      return new Response(JSON.stringify({ error: "SSX HashAuth must be a string" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (hashcode !== undefined && hashcode !== null && typeof hashcode !== "string") {
      return new Response(JSON.stringify({ error: "SSX Hashcentral must be a string" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const personSettingInputs: Array<[string, unknown]> = [
      ["organization_unit_integration_code", organization_unit_integration_code],
      ["person_role_integration_code", person_role_integration_code],
      ["work_schedule_integration_code", work_schedule_integration_code],
    ];
    for (const [name, value] of personSettingInputs) {
      if (value !== undefined && value !== null &&
        (typeof value !== "string" || value.trim().length > 40)) {
        return new Response(JSON.stringify({ error: `${name} must contain at most 40 characters` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    let normalizedBaseUrl: string;
    try {
      normalizedBaseUrl = normalizeSsxBaseUrl(base_url);
    } catch {
      return new Response(JSON.stringify({
        error: "SSX base URL is not allowed",
        code: "SSX_BASE_URL_NOT_ALLOWED",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tenantContextError = requireActiveTenant(req, tenant_id, corsHeaders);
    if (tenantContextError) return tenantContextError;

    // Verify admin
    const { data: membership } = await supabase
      .from("tenant_memberships")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", callerId)
      .eq("active", true)
      .limit(1)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // New credentials must never be persisted as plaintext.
    const encryptedPassword = await encrypt(password, encryptionKey);

    let settings: JsonObject = {};
    let currentHashauth: string | null = null;
    let currentHashcode: string | null = null;
    if (id) {
      const [{ data: current, error: currentError }, { data: accountMatches, error: matchError }] = await Promise.all([
        supabase.from("integration_accounts").select("settings, hashauth, hashcode").eq("id", id).maybeSingle(),
        supabase.rpc("integration_account_matches_tenant_workspace_v1", {
          _tenant_id: tenant_id,
          _integration_account_id: id,
        }),
      ]);
      if (currentError || matchError) throw currentError || matchError;
      if (!current || accountMatches !== true) {
        return new Response(JSON.stringify({ error: "Workspace SSX account not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      settings = (current?.settings && typeof current.settings === "object")
        ? { ...(current.settings as JsonObject) }
        : {};
      currentHashauth = current?.hashauth || null;
      currentHashcode = current?.hashcode || null;
    }

    const submittedHashauth = typeof hashauth === "string" ? hashauth.trim() : "";
    const submittedHashcentral = typeof hashcode === "string" ? hashcode.trim() : "";
    const effectiveHashauth = submittedHashauth || currentHashauth;
    const effectiveHashcentral = submittedHashcentral || currentHashcode;
    if (!effectiveHashauth) {
      return new Response(JSON.stringify({
        error: "SSX HashAuth is required for the Tracking integration",
        code: "SSX_HASHAUTH_REQUIRED",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!username.includes("@") && !effectiveHashcentral) {
      return new Response(JSON.stringify({
        error: "SSX Hashcentral is required when username is not an email",
        code: "SSX_HASHCENTRAL_REQUIRED",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentAdministrationEnabled = settings.administration_enabled === true;
    settings.administration_enabled = administration_enabled === undefined
      ? currentAdministrationEnabled
      : administration_enabled;
    for (const [name, value] of personSettingInputs) {
      if (value === undefined) continue;
      const normalized = typeof value === "string" ? value.trim() : "";
      if (normalized) settings[name] = normalized;
      else delete settings[name];
    }

    // A credential replacement starts a clean authentication lifecycle. Keeping
    // a stale token or an old backoff here made a valid replacement look broken.
    for (const key of [
      "credential_reentry_required",
      "ssx_login_backoff_count",
      "ssx_login_backoff_until",
      "sync_units_backoff_count",
      "sync_units_backoff_until",
      "skip_admin_until",
      "last_admin_error",
      "admin_token_cache",
      "admin_token_expires_at",
    ]) {
      delete settings[key];
    }

    const { data: resultId, error: upsertError } = await supabase.rpc(
      "upsert_workspace_ssx_account_v1",
      {
        _tenant_id: tenant_id,
        _integration_account_id: id || null,
        _base_url: normalizedBaseUrl,
        _username: username,
        _password_encrypted: encryptedPassword,
        _hashauth: effectiveHashauth,
        _hashcode: effectiveHashcentral,
        _settings: settings,
      },
    );
    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ success: true, id: resultId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("agvlog-integration-upsert error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function encrypt(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex.padEnd(64, "0").slice(0, 64));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const ivHex = bytesToHex(iv);
  const ctHex = bytesToHex(new Uint8Array(ciphertext));
  return `enc:v1:${ivHex}:${ctHex}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
