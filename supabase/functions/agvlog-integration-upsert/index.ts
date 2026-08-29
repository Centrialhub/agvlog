import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

type JsonObject = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
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

    const { tenant_id, base_url, username, password, hashauth, hashcode, id } = await req.json();
    if (!tenant_id || !username || !password) {
      return new Response(
        JSON.stringify({ error: "tenant_id, username, password required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      const { data: current, error: currentError } = await supabase
        .from("integration_accounts")
        .select("settings, hashauth, hashcode")
        .eq("id", id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (currentError) throw currentError;
      settings = (current?.settings && typeof current.settings === "object")
        ? { ...(current.settings as JsonObject) }
        : {};
      currentHashauth = current?.hashauth || null;
      currentHashcode = current?.hashcode || null;
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

    const record = {
      tenant_id,
      base_url: base_url || "https://integration.systemsatx.com.br",
      username,
      password_encrypted: encryptedPassword,
      hashauth: hashauth || currentHashauth,
      hashcode: hashcode || currentHashcode,
      status: "pending",
      token_cache: null,
      token_expires_at: null,
      last_error: null,
      last_login_at: null,
      settings,
    };

    let result;
    if (id) {
      const { data, error } = await supabase
        .from("integration_accounts")
        .update(record)
        .eq("id", id)
        .eq("tenant_id", tenant_id)
        .select("id")
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from("integration_accounts")
        .insert(record)
        .select("id")
        .single();
      if (error) throw error;
      result = data;
    }

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("agvlog-integration-upsert error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: errorMessage(err) }),
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
