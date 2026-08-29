import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { corsHeaders } from "../_shared/cors.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const encoder = new TextEncoder();
const BUCKET_ROLES: Record<string, readonly string[]> = {
  receipts: ["owner", "admin", "operator", "driver"],
  "occurrence-return-proofs": ["owner", "admin", "operator"],
  "pallet-return-proofs": ["owner", "admin", "operator"],
};
const KIND_MIMES: Record<string, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  proof: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
  financial: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "application/xml"],
};

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  const text = new TextDecoder().decode(bytes.slice(0, 2_048)).replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("<") && !/<!DOCTYPE/i.test(text) && !/<script[\s>]/i.test(text)) return "application/xml";
  return null;
}

function safeName(value: string) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120) || "arquivo";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function actorFingerprint(serviceKey: string, userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${serviceKey}:${userId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeQuota(
  adminClient: SupabaseClient,
  fingerprint: string,
  action: "upload" | "cleanup",
) {
  const { data, error } = await adminClient.rpc("consume_secure_upload_quota_v1", {
    p_actor_fingerprint: fingerprint,
    p_action: action,
    p_max_requests: action === "upload" ? 10 : 30,
    p_window_seconds: 60,
  });
  return !error && data === true;
}

async function scannerAccepts(file: File, correlationId: string) {
  const scannerUrl = Deno.env.get("MALWARE_SCANNER_URL")?.trim();
  const scannerToken = Deno.env.get("MALWARE_SCANNER_TOKEN")?.trim();
  if (!scannerUrl || !scannerToken) return { available: false, clean: false };
  const url = new URL(scannerUrl);
  if (url.protocol !== "https:") return { available: false, clean: false };

  const data = new FormData();
  data.set("file", file, file.name);
  const scan = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${scannerToken}`, "x-correlation-id": correlationId },
    body: data,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!scan.ok) return { available: false, clean: false };
  const result = await scan.json() as { clean?: boolean };
  return { available: true, clean: result.clean === true };
}

async function authorizeUpload(
  adminClient: SupabaseClient,
  callerClient: SupabaseClient,
  userId: string,
  tenantId: string,
  bucket: string,
) {
  const { data: membership } = await adminClient
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!membership || !BUCKET_ROLES[bucket]?.includes(String(membership.role))) return false;
  if (["owner", "admin"].includes(String(membership.role))) {
    const assurance = await callerClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2") return false;
  }
  return true;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("authorization");
  if (!authorization) return response(401, { error: "missing_authorization" });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES + 64 * 1024) return response(413, { error: "invalid_file_size" });
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return response(503, { error: "upload_gateway_not_configured" });

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return response(401, { error: "invalid_token" });

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const fingerprint = await actorFingerprint(serviceKey, user.id);
    if (request.headers.get("content-type")?.includes("application/json")) {
      const cleanup = await request.json() as { action?: unknown; tenant_id?: unknown; bucket?: unknown; paths?: unknown };
      const tenantId = String(cleanup.tenant_id ?? "");
      const bucket = String(cleanup.bucket ?? "");
      const paths = Array.isArray(cleanup.paths) ? cleanup.paths.filter((path): path is string => typeof path === "string") : [];
      const validPaths = paths.length > 0 && paths.length <= 10 && paths.every((path) =>
        path.startsWith(`${tenantId}/`) && !path.includes("..") && path.length <= 500
      );
      if (cleanup.action !== "cleanup" || !validUuid(tenantId) || !BUCKET_ROLES[bucket] || !validPaths) {
        return response(400, { error: "invalid_cleanup_request" });
      }
      if (!await authorizeUpload(adminClient, callerClient, user.id, tenantId, bucket)) {
        return response(403, { error: "tenant_or_role_denied" });
      }
      if (!await consumeQuota(adminClient, fingerprint, "cleanup")) {
        return response(429, { error: "upload_rate_limited", correlation_id: correlationId });
      }
      const { error: cleanupError } = await adminClient.storage.from(bucket).remove(paths);
      if (cleanupError) return response(503, { error: "cleanup_unavailable", correlation_id: correlationId });
      return response(200, { removed: paths.length, correlation_id: correlationId });
    }

    const form = await request.formData();
    const tenantId = String(form.get("tenant_id") ?? "");
    const bucket = String(form.get("bucket") ?? "");
    const folder = String(form.get("folder") ?? "");
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    if (!validUuid(tenantId) || !(file instanceof File) || !BUCKET_ROLES[bucket] || !KIND_MIMES[kind]) {
      return response(400, { error: "invalid_upload_request" });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) return response(413, { error: "invalid_file_size" });

    const segments = folder.split("/").filter(Boolean);
    if (segments.length < 1 || segments.length > 6 || segments.some((part) => !/^[a-zA-Z0-9_-]{1,80}$/.test(part))) {
      return response(400, { error: "invalid_upload_folder" });
    }

    if (!await authorizeUpload(adminClient, callerClient, user.id, tenantId, bucket)) {
      return response(403, { error: "tenant_or_role_denied" });
    }
    if (!await consumeQuota(adminClient, fingerprint, "upload")) {
      return response(429, { error: "upload_rate_limited", correlation_id: correlationId });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectMime(bytes);
    if (!mime || !KIND_MIMES[kind].includes(mime)) return response(415, { error: "file_signature_mismatch" });

    const scan = await scannerAccepts(file, correlationId);
    if (!scan.available) return response(503, { error: "malware_scanner_unavailable" });
    if (!scan.clean) return response(422, { error: "malware_detected" });

    const path = `${tenantId}/${segments.join("/")}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error: uploadError } = await adminClient.storage.from(bucket).upload(path, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadError) {
      console.error("[secure-upload] storage failure", { correlation_id: correlationId, code: uploadError.name });
      return response(503, { error: "storage_unavailable", correlation_id: correlationId });
    }

    return response(201, { path, content_type: mime, size: file.size, correlation_id: correlationId });
  } catch (cause: unknown) {
    console.error("[secure-upload] rejected", {
      correlation_id: correlationId,
      error_name: cause instanceof Error ? cause.name : "UnknownError",
    });
    return response(400, { error: "invalid_upload", correlation_id: correlationId });
  }
});
